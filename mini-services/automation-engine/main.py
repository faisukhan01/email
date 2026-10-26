"""
AI Automation Engine — FastAPI mini-service (port 3030)

Architecture notes (patterns adopted from morluto/rea reference repo):
- Lease-based job claiming: pending jobs are claimed atomically with
  claimedBy + leaseExpiresAt so two workers can never double-send.
- Evidence envelopes: every outbound message records provider identity,
  confidence level, limitations, and timestamps.
- Bounded execution: batch caps, timeouts, and retry-with-backoff caps.
- Observational events: event-stream writes never mutate job truth.

Queue contract (ea_execution table):
  status: pending -> running -> done | failed (retry) | dead
  types:  campaign_dispatch | sequence_step | send_single | enroll_contacts
"""

import asyncio
import json
import logging
import os
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import httpx
import libsql_client
import aiosmtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))

TURSO_URL = os.environ.get("TURSO_DATABASE_URL", "")
TURSO_TOKEN = os.environ.get("TURSO_AUTH_TOKEN", "")
ENGINE_SECRET = os.environ.get("ENGINE_SECRET", "engine-dev-secret")

TICK_INTERVAL_SECONDS = 15
MAX_JOBS_PER_TICK = 25
MAX_FANOUT_PER_TICK = 150
JOB_TIMEOUT_SECONDS = 55
LEASE_SECONDS = 90
RETRY_BACKOFF = [60, 300, 900]  # seconds after attempt 1, 2, 3
BOUNCE_RATE_SIM = 0.03
OPEN_RATE_SIM = 0.55
CLICK_RATE_SIM = 0.35

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("engine")

if not TURSO_URL:
    raise RuntimeError("TURSO_DATABASE_URL missing — engine cannot start")

# The sandbox/proxy environment blocks raw websockets; the HTTP/2 pipeline
# API (same host, https:// scheme) is the supported transport here.
_HTTP_URL = TURSO_URL.replace("libsql://", "https://") if TURSO_URL.startswith("libsql://") else TURSO_URL
client = libsql_client.create_client(url=_HTTP_URL, auth_token=TURSO_TOKEN)

app = FastAPI(title="AI Automation Engine", version="1.0.0")
_worker_task: Optional[asyncio.Task] = None
_worker_id = f"engine-{uuid.uuid4().hex[:8]}"


# ─────────────────────────── helpers ───────────────────────────

def now() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    """Prisma-compatible SQLite DateTime format."""
    return dt.astimezone(timezone.utc).isoformat(timespec="milliseconds")


async def q(sql: str, args: List[Any] = None):
    """Execute a statement against Turso with bounded retry on transient errors."""
    global client
    last_err = None
    for attempt in range(3):
        try:
            rs = await client.execute(sql, args or [])
            return rs
        except Exception as e:
            last_err = e
            msg = str(e).lower()
            transient = any(k in msg for k in ("disconnected", "timeout", "reset", "400", "unavailable", "eof"))
            if not transient:
                raise
            await asyncio.sleep(0.4 * (attempt + 1))
            if attempt >= 1:
                # recreate the HTTP client to drop dead sockets
                _HTTP_URL_2 = TURSO_URL.replace("libsql://", "https://") if TURSO_URL.startswith("libsql://") else TURSO_URL
                client = libsql_client.create_client(url=_HTTP_URL_2, auth_token=TURSO_TOKEN)
    raise last_err


async def q_rows(sql: str, args: List[Any] = None) -> List[Dict[str, Any]]:
    rs = await q(sql, args)
    cols = rs.columns or []
    if cols and not isinstance(cols[0], str):
        cols = [c["name"] for c in cols]
    rows = []
    for row in rs.rows:
        try:
            rows.append({col: row[i] for i, col in enumerate(cols)})
        except Exception:
            rows.append(dict(row))
    return rows


def parse_dt(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    s = str(value)
    for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ"):
        try:
            return datetime.strptime(s.replace("T", " "), fmt.replace("T", " ")) if "T" not in s else datetime.strptime(s, fmt)
        except ValueError:
            continue
    try:
        from datetime import datetime as dt
        return dt.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


async def record_event(workspace_id: str, etype: str, contact_id: str = None,
                       campaign_id: str = None, message_id: str = None, metadata: dict = None):
    """Observational event recording — never fails the caller (REA pattern)."""
    try:
        await q(
            "INSERT INTO ea_event (id, workspaceId, type, contactId, campaignId, messageId, metadata, createdAt) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [f"evt_{uuid.uuid4().hex[:20]}", workspace_id, etype, contact_id, campaign_id, message_id,
             json.dumps(metadata or {}), iso(now())],
        )
    except Exception as e:  # noqa
        log.warning(f"event recording failed: {e}")



SECRETS_CACHE: Dict[str, tuple[float, Dict[str, Any]]] = {}
SECRETS_TTL_SECONDS = 60
NEXTJS_BASE = os.environ.get("NEXTJS_BASE", "http://localhost:3000")


async def fetch_workspace_secrets(workspace_id: str) -> Dict[str, Any]:
    """Fetches decrypted integration secrets from the Next.js internal endpoint.
    Short TTL cache to bound round-trips (REA: cache with explicit invalidation)."""
    import time as _time
    cached = SECRETS_CACHE.get(workspace_id)
    if cached and (_time.monotonic() - cached[0]) < SECRETS_TTL_SECONDS:
        return cached[1]
    async with httpx.AsyncClient(timeout=8) as http:
        res = await http.get(
            f"{NEXTJS_BASE}/api/internal/secrets",
            params={"workspaceId": workspace_id},
            headers={"x-engine-secret": ENGINE_SECRET},
        )
        res.raise_for_status()
        body = res.json()
        data = body.get("data") if body.get("ok") else body
        SECRETS_CACHE[workspace_id] = (_time.monotonic(), data)
        return data


def evidence_envelope(provider: str, simulated: bool, extra: dict = None) -> str:
    return json.dumps({
        "provider": provider,
        "confidence": "inferred" if simulated else "observed",
        "simulated": simulated,
        "limitations": ["Simulation mode — delivery not performed by a real provider"] if simulated else [],
        "recordedAt": now().isoformat(),
        **(extra or {}),
    })


def render_vars(text: str, contact: Dict[str, Any]) -> str:
    first = contact.get("firstName") or (contact.get("email") or "").split("@")[0]
    mapping = {
        "first_name": first,
        "last_name": contact.get("lastName") or "",
        "full_name": f"{contact.get('firstName') or ''} {contact.get('lastName') or ''}".strip() or first,
        "email": contact.get("email") or "",
        "company": contact.get("company") or "",
        "job_title": contact.get("jobTitle") or "",
        "country": contact.get("country") or "",
        "city": contact.get("city") or "",
        "phone": contact.get("phone") or "",
    }
    import re
    def sub(m):
        key = m.group(1).strip().lower()
        return mapping.get(key, m.group(0))
    return re.sub(r"\{\{\s*(\w+)\s*\}\}", sub, text or "")


def snippet(html: str, limit: int = 160) -> str:
    import re
    text = re.sub(r"<[^>]+>", " ", html or "")
    text = re.sub(r"\s+", " ", text).strip()
    return text[: limit - 1] + "…" if len(text) > limit else text


# ─────────────────────────── senders ───────────────────────────

async def send_via_smtp(integration: Dict[str, Any], secret: str, to: str, subject: str,
                        html: str, text: str, from_name: str, from_email: str, reply_to: str) -> Dict[str, Any]:
    from_email = from_email or integration.get("fromEmail") or "hello@example.com"
    from_name = from_name or integration.get("fromName") or "Automation Platform"
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{from_name} <{from_email}>"
    msg["To"] = to
    if reply_to:
        msg["Reply-To"] = reply_to
    if text:
        msg.attach(MIMEText(text, "plain"))
    msg.attach(MIMEText(html or text or "", "html"))
    host = integration.get("smtpHost")
    port = int(integration.get("smtpPort") or 587)
    await aiosmtplib.send(
        msg, hostname=host, port=port,
        username=integration.get("smtpUser") or None,
        password=secret, start_tls=port in (587, 2587),
        timeout=25,
    )
    return {"provider": "smtp", "providerMsgId": None}


async def send_via_resend(api_key: str, to: str, subject: str, html: str, text: str,
                          from_name: str, from_email: str, reply_to: str) -> Dict[str, Any]:
    from_email = from_email or "onboarding@resend.dev"
    async with httpx.AsyncClient(timeout=25) as http:
        res = await http.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "from": f"{from_name or 'Automation'} <{from_email}>",
                "to": [to],
                "subject": subject,
                "html": html or None,
                "text": text or None,
                **({"reply_to": reply_to} if reply_to else {}),
            },
        )
    if res.status_code >= 300:
        raise RuntimeError(f"Resend API {res.status_code}: {res.text[:200]}")
    data = res.json()
    return {"provider": "resend", "providerMsgId": data.get("id")}


async def send_via_whatsapp_cloud(token: str, phone_id: str, to: str, body: str) -> Dict[str, Any]:
    async with httpx.AsyncClient(timeout=25) as http:
        res = await http.post(
            f"https://graph.facebook.com/v21.0/{phone_id}/messages",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"messaging_product": "whatsapp", "to": to, "type": "text", "text": {"preview_url": False, "body": body}},
        )
    if res.status_code >= 300:
        raise RuntimeError(f"WhatsApp API {res.status_code}: {res.text[:200]}")
    data = res.json()
    return {"provider": "whatsapp_cloud", "providerMsgId": (data.get("messages") or [{}])[0].get("id")}


async def dispatch_message(workspace_id: str, contact: Dict[str, Any], channel: str,
                           subject: str, html: str, text: str, campaign_id: str = None,
                           from_name: str = "", from_email: str = "", reply_to: str = "",
                           is_test: bool = False) -> Dict[str, Any]:
    """Single message dispatch with full evidence envelope. Returns message record."""
    integration = (await q_rows(
        "SELECT * FROM ea_integration WHERE workspaceId = ? LIMIT 1", [workspace_id]
    ) or [{}])[0]
    ws = (await q_rows("SELECT simulationMode FROM ea_workspace WHERE id = ?", [workspace_id]) or [{}])[0]
    simulation = bool(ws.get("simulationMode", 1))

    provider_used = "simulator"
    provider_msg_id = f"sim_{uuid.uuid4().hex[:12]}"
    error = None

    if not simulation and not is_test:
        try:
            secrets = await fetch_workspace_secrets(workspace_id)
            if channel == "email":
                provider_mode = (secrets.get("emailProvider") or "smtp").lower()
                if provider_mode == "resend" and secrets.get("resendApiKey"):
                    r = await send_via_resend(secrets["resendApiKey"], contact["email"], subject, html, text, from_name, from_email, reply_to)
                    provider_used, provider_msg_id = r["provider"], r["providerMsgId"] or provider_msg_id
                elif provider_mode == "smtp" and secrets.get("smtp", {}).get("host") and secrets["smtp"].get("pass"):
                    smtp_cfg = {**integration, **{k: v for k, v in secrets["smtp"].items() if v}}
                    r = await send_via_smtp(smtp_cfg, secrets["smtp"]["pass"], contact["email"], subject, html, text, from_name, from_email, reply_to)
                    provider_used, provider_msg_id = r["provider"], provider_msg_id
                else:
                    raise RuntimeError("Email provider not fully configured")
            elif channel == "whatsapp":
                wa = secrets.get("whatsapp") or {}
                if wa.get("accessToken") and wa.get("phoneNumberId"):
                    r = await send_via_whatsapp_cloud(wa["accessToken"], wa["phoneNumberId"], contact.get("phone") or "", text or html[:1024])
                    provider_used, provider_msg_id = r["provider"], r["providerMsgId"] or provider_msg_id
                else:
                    raise RuntimeError("WhatsApp Cloud API not fully configured")
        except Exception as e:
            error = str(e)[:300]
    else:
        # Simulator: honest evidence, no real delivery
        pass

    to_address = contact["email"] if channel == "email" else (contact.get("phone") or contact["email"])
    status = "failed" if error else "sent"
    if simulation and not is_test and not error and channel == "email" and __import__("random").random() < BOUNCE_RATE_SIM:
        status = "bounced"

    message_id = f"msg_{uuid.uuid4().hex[:20]}"
    ts = iso(now())
    await q(
        "INSERT INTO ea_message (id, workspaceId, campaignId, contactId, channel, toAddress, subject, bodySnippet,"
        " status, provider, providerMsgId, error, evidence, sentAt, bouncedAt, createdAt, updatedAt)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [message_id, workspace_id, campaign_id, contact["id"], channel, to_address,
         (subject or "")[:200], snippet(html or text), status, provider_used, provider_msg_id,
         error, evidence_envelope(provider_used, simulation and not is_test),
         ts if not error else None, ts if status == "bounced" else None, ts, ts],
    )
    event_type = f"{'email' if channel == 'email' else 'whatsapp'}.{'bounced' if status == 'bounced' else 'sent'}"
    await record_event(workspace_id, event_type, contact_id=contact["id"], campaign_id=campaign_id,
                       message_id=message_id, metadata={"provider": provider_used, "test": is_test})
    return {"messageId": message_id, "status": status, "error": error, "provider": provider_used}


# ─────────────────────── job execution ───────────────────────────

async def resolve_audience(workspace_id: str, campaign: Dict[str, Any]) -> List[Dict[str, Any]]:
    audience_type = campaign.get("audienceType") or "list"
    if audience_type == "all":
        return await q_rows(
            "SELECT * FROM ea_contact WHERE workspaceId = ? AND status = 'subscribed' LIMIT ?",
            [workspace_id, MAX_FANOUT_PER_TICK],
        )
    if audience_type == "list" and campaign.get("listId"):
        return await q_rows(
            "SELECT c.* FROM ea_contact c JOIN ea_list_membership m ON m.contactId = c.id"
            " WHERE m.listId = ? AND c.status = 'subscribed' LIMIT ?",
            [campaign["listId"], MAX_FANOUT_PER_TICK],
        )
    # segment rules
    try:
        rules = json.loads(campaign.get("segmentRules") or "[]")
    except json.JSONDecodeError:
        rules = []
    rows = await q_rows(
        "SELECT id, email, firstName, lastName, phone, company, jobTitle, country, city, status,"
        " lifecycleStage, leadScore, tags FROM ea_contact WHERE workspaceId = ? AND status = 'subscribed' LIMIT ?",
        [workspace_id, MAX_FANOUT_PER_TICK],
    )
    # Apply rules in Python (bounded set, same semantics as Next.js evaluator)
    import sys
    sys.path.insert(0, os.path.dirname(__file__))
    return [r for r in rows if rules_match(r, rules)]


def rules_match(contact: Dict[str, Any], rules: List[Dict[str, Any]]) -> bool:
    if not rules:
        return True
    tags = []
    try:
        tags = json.loads(contact.get("tags") or "[]")
    except json.JSONDecodeError:
        pass
    fields = {
        "email": contact.get("email") or "", "firstName": contact.get("firstName") or "",
        "lastName": contact.get("lastName") or "", "company": contact.get("company") or "",
        "country": contact.get("country") or "", "city": contact.get("city") or "",
        "jobTitle": contact.get("jobTitle") or "", "status": contact.get("status") or "",
        "lifecycleStage": contact.get("lifecycleStage") or "",
        "leadScore": contact.get("leadScore") or 0, "phone": contact.get("phone") or "",
        "tags": ",".join(tags),
    }

    def one(rule) -> bool:
        actual = fields.get(rule.get("field"), "")
        v = (rule.get("value") or "")
        op = rule.get("operator")
        s_actual = str(actual).lower()
        try:
            if op == "equals": return s_actual == v.lower()
            if op == "not_equals": return s_actual != v.lower()
            if op == "contains": return v.lower() in s_actual
            if op == "not_contains": return v.lower() not in s_actual
            if op == "starts_with": return s_actual.startswith(v.lower())
            if op == "gt": return float(actual) > float(v)
            if op == "lt": return float(actual) < float(v)
            if op == "in": return s_actual in [x.strip().lower() for x in v.split(",")]
            if op == "not_empty": return s_actual.strip() != ""
            if op == "is_empty": return s_actual.strip() == ""
        except (ValueError, TypeError):
            return False
        return False

    acc = one(rules[0])
    for r in rules[1:]:
        m = one(r)
        acc = (acc or m) if (r.get("conjunction") or "AND") == "OR" else (acc and m)
    return acc


async def exec_campaign_dispatch(job: Dict[str, Any]) -> str:
    payload = json.loads(job.get("payload") or "{}")
    campaign_id = payload.get("campaignId")
    workspace_id = job["workspaceId"]
    campaign = (await q_rows("SELECT * FROM ea_campaign WHERE id = ? AND workspaceId = ?",
                             [campaign_id, workspace_id]) or [None])[0]
    if not campaign:
        return "done"
    if campaign.get("status") not in ("sending", "scheduled"):
        return "done"

    await q("UPDATE ea_campaign SET status = 'sending', startedAt = COALESCE(startedAt, ?) WHERE id = ?",
            [iso(now()), campaign_id])

    audience = await resolve_audience(workspace_id, campaign)
    for contact in audience:
        # Per-recipient fanout as independent high-priority jobs (bounded per tick)
        await q(
            "INSERT INTO ea_execution (id, workspaceId, type, status, priority, payload, runAt, createdAt, updatedAt)"
            " VALUES (?, ?, 'send_single', 'pending', 2, ?, ?, ?, ?)",
            [f"exe_{uuid.uuid4().hex[:20]}", workspace_id,
             json.dumps({
                 "campaignId": campaign_id, "contactId": contact["id"], "channel": campaign.get("channel") or "email",
                 "subject": render_vars(campaign.get("subject") or "", contact),
                 "bodyHtml": render_vars(campaign.get("bodyHtml") or "", contact),
                 "bodyText": render_vars(campaign.get("bodyText") or "", contact),
                 "fromName": campaign.get("fromName") or "", "fromEmail": campaign.get("fromEmail") or "",
                 "replyTo": campaign.get("replyTo") or "",
             }),
             iso(now()),
             iso(now()),
             iso(now())],
        )
    log.info(f"campaign {campaign_id}: fanned out to {len(audience)} recipients")
    return "done"


async def exec_send_single(job: Dict[str, Any]) -> str:
    payload = json.loads(job.get("payload") or "{}")
    workspace_id = job["workspaceId"]
    contact_id = payload.get("contactId")

    if contact_id:
        contact = (await q_rows("SELECT * FROM ea_contact WHERE id = ? AND workspaceId = ?",
                                [contact_id, workspace_id]) or [None])[0]
        if not contact or contact.get("status") == "unsubscribed":
            return "done"
        to = contact
    else:
        to = {"id": None, "email": payload.get("to"), "firstName": "", "lastName": "",
              "phone": payload.get("to"), "company": ""}

    result = await dispatch_message(
        workspace_id, to, payload.get("channel") or "email",
        subject=payload.get("subject") or "", html=payload.get("bodyHtml") or "",
        text=payload.get("bodyText") or "", campaign_id=payload.get("campaignId"),
        from_name=payload.get("fromName") or "", from_email=payload.get("fromEmail") or "",
        reply_to=payload.get("replyTo") or "", is_test=bool(payload.get("isTest")),
    )
    await maybe_finalize_campaign(workspace_id, payload.get("campaignId"))
    return "done" if result["status"] != "failed" else "failed"


async def sweep_campaigns():
    """Post-tick supervision: finalize campaigns whose fanout jobs are all terminal.
    Runs outside any single job's lifecycle so self-referencing rows cannot
    block finalization (REA: own the lifecycle)."""
    stamp = iso(now())
    sending = await q_rows(
        "SELECT id, workspaceId FROM ea_campaign WHERE status = 'sending' LIMIT 20"
    )
    for camp in sending:
        pending = await q_rows(
            "SELECT COUNT(*) AS n FROM ea_execution WHERE workspaceId = ? AND status IN ('pending','running')"
            " AND payload LIKE ?",
            [camp["workspaceId"], f'%{camp["id"]}%'],
        )
        if (pending[0]["n"] if pending else 0) > 0:
            continue
        msgs = await q_rows(
            "SELECT COUNT(*) AS total FROM ea_message WHERE campaignId = ?",
            [camp["id"]],
        )
        if (msgs[0]["total"] if msgs else 0) > 0:
            await q(
                "UPDATE ea_campaign SET status = 'sent', completedAt = ? WHERE id = ? AND status = 'sending'",
                [stamp, camp["id"]],
            )
            await record_event(camp["workspaceId"], "campaign.completed", campaign_id=camp["id"],
                               metadata={"recipients": msgs[0]["total"]})
            log.info(f"campaign {camp['id']} finalized as sent ({msgs[0]['total']} messages)")


def delay_seconds(amount: int, unit: str) -> int:
    if unit == "minutes":
        return amount * 60
    if unit == "hours":
        return amount * 3600
    return amount * 86400


async def exec_sequence_step(job: Dict[str, Any]) -> str:
    payload = json.loads(job.get("payload") or "{}")
    workspace_id = job["workspaceId"]
    sequence_id = payload.get("sequenceId")
    contact_id = payload.get("contactId")
    step_position = int(payload.get("stepPosition") or 1)

    sequence = (await q_rows("SELECT * FROM ea_sequence WHERE id = ? AND workspaceId = ?",
                             [sequence_id, workspace_id]) or [None])[0]
    contact = (await q_rows("SELECT * FROM ea_contact WHERE id = ? AND workspaceId = ?",
                            [contact_id, workspace_id]) or [None])[0]
    if not sequence or not contact:
        return "done"
    if sequence.get("status") != "active":
        return "done"
    enrollment = (await q_rows("SELECT * FROM ea_enrollment WHERE sequenceId = ? AND contactId = ?",
                               [sequence_id, contact_id]) or [None])[0]
    if not enrollment or enrollment.get("status") != "active":
        return "done"

    steps = await q_rows("SELECT * FROM ea_sequence_step WHERE sequenceId = ? ORDER BY position ASC LIMIT 30",
                         [sequence_id])
    step = next((s for s in steps if s["position"] == step_position), None)
    if not step:
        await q("UPDATE ea_enrollment SET status = 'completed', completedAt = ? WHERE id = ?",
                [iso(now()), enrollment["id"]])
        return "done"

    config = json.loads(step.get("config") or "{}")
    step_type = step.get("type")
    result = "done"

    if step_type == "send_email":
        r = await dispatch_message(workspace_id, contact, "email",
                                   subject=render_vars(config.get("subject") or "", contact),
                                   html=render_vars(config.get("bodyHtml") or "", contact),
                                   text=render_vars(config.get("bodyText") or "", contact))
        result = "done" if r["status"] != "failed" else "failed"
        if result == "failed":
            await q("UPDATE ea_enrollment SET status = 'failed', exitReason = ? WHERE id = ?",
                    [r.get("error") or "send failed", enrollment["id"]])
            return "failed"
    elif step_type == "send_whatsapp":
        r = await dispatch_message(workspace_id, contact, "whatsapp",
                                   subject="", html="",
                                   text=render_vars(config.get("bodyText") or "", contact))
        result = "done" if r["status"] != "failed" else "failed"
    elif step_type == "wait":
        pass  # handled below when scheduling next step
    elif step_type == "add_tag":
        tags = []
        try:
            tags = json.loads(contact.get("tags") or "[]")
        except json.JSONDecodeError:
            pass
        tag = config.get("tag") or ""
        if tag and tag not in tags:
            tags.append(tag)
        await q("UPDATE ea_contact SET tags = ?, updatedAt = ? WHERE id = ?",
                [json.dumps(tags), iso(now()), contact_id])
    elif step_type == "remove_tag":
        tags = []
        try:
            tags = json.loads(contact.get("tags") or "[]")
        except json.JSONDecodeError:
            pass
        tag = config.get("tag") or ""
        await q("UPDATE ea_contact SET tags = ?, updatedAt = ? WHERE id = ?",
                [json.dumps([t for t in tags if t != tag]),
                 iso(now()), contact_id])
    elif step_type == "update_field":
        field = config.get("field")
        value = str(config.get("value") or "")
        allowed = {"firstName", "lastName", "phone", "company", "jobTitle", "country", "city", "lifecycleStage", "notes"}
        if field in allowed:
            await q(f"UPDATE ea_contact SET {field} = ?, updatedAt = ? WHERE id = ?",
                    [value, iso(now()), contact_id])

    await q("UPDATE ea_enrollment SET currentPosition = ? WHERE id = ?",
            [step_position, enrollment["id"]])

    # Schedule the next step
    next_step = next((s for s in steps if s["position"] == step_position + 1), None)
    run_at = now()
    if next_step:
        next_config = json.loads(next_step.get("config") or "{}")
        wait_seconds = delay_seconds(int(next_config.get("delayAmount") or 0),
                                     next_config.get("delayUnit") or "days")
        run_at = run_at + timedelta(seconds=wait_seconds)
        await q(
            "INSERT INTO ea_execution (id, workspaceId, type, status, priority, payload, runAt, createdAt, updatedAt)"
            " VALUES (?, ?, 'sequence_step', 'pending', 5, ?, ?, ?, ?)",
            [f"exe_{uuid.uuid4().hex[:20]}", workspace_id,
             json.dumps({"sequenceId": sequence_id, "contactId": contact_id, "stepPosition": step_position + 1}),
             iso(run_at),
             iso(now()),
             iso(now())],
        )
    else:
        await q("UPDATE ea_enrollment SET status = 'completed', completedAt = ? WHERE id = ?",
                [iso(now()), enrollment["id"]])
        await record_event(workspace_id, "sequence.completed", contact_id=contact_id,
                           metadata={"sequenceId": sequence_id})
    return result


async def exec_enroll_contacts(job: Dict[str, Any]) -> str:
    payload = json.loads(job.get("payload") or "{}")
    workspace_id = job["workspaceId"]
    sequence_id = payload.get("sequenceId")
    contact_ids = payload.get("contactIds") or []
    steps = await q_rows("SELECT id, position FROM ea_sequence_step WHERE sequenceId = ? ORDER BY position LIMIT 1",
                         [sequence_id])
    if not steps:
        return "done"
    for cid in contact_ids[:200]:
        existing = await q_rows("SELECT id, status FROM ea_enrollment WHERE sequenceId = ? AND contactId = ?",
                                [sequence_id, cid])
        if existing and existing[0].get("status") == "active":
            continue
        if existing:
            await q("UPDATE ea_enrollment SET status='active', currentPosition=0, completedAt=NULL WHERE id = ?",
                    [existing[0]["id"]])
        else:
            await q("INSERT INTO ea_enrollment (id, workspaceId, sequenceId, contactId, status, currentPosition, enteredAt)"
                    " VALUES (?, ?, ?, ?, 'active', 0, ?)",
                    [f"enr_{uuid.uuid4().hex[:20]}", workspace_id, sequence_id, cid,
                     iso(now())])
        await q(
            "INSERT INTO ea_execution (id, workspaceId, type, status, priority, payload, runAt, createdAt, updatedAt)"
            " VALUES (?, ?, 'sequence_step', 'pending', 5, ?, ?, ?, ?)",
            [f"exe_{uuid.uuid4().hex[:20]}", workspace_id,
             json.dumps({"sequenceId": sequence_id, "contactId": cid, "stepPosition": 1}),
             iso(now()),
             iso(now()),
             iso(now())],
        )
    return "done"


EXECUTORS = {
    "campaign_dispatch": exec_campaign_dispatch,
    "send_single": exec_send_single,
    "sequence_step": exec_sequence_step,
    "enroll_contacts": exec_enroll_contacts,
}


# ─────────────────────── worker loop ───────────────────────────

async def claim_jobs() -> List[Dict[str, Any]]:
    """Lease-based claiming: UPDATE with ownership stamp; only rows we
    successfully transitioned from pending->running are returned (REA pattern)."""
    due_rows = await q_rows(
        "SELECT id FROM ea_execution WHERE status = 'pending' AND runAt <= ?"
        " ORDER BY priority ASC, runAt ASC LIMIT ?",
        [iso(now()), MAX_JOBS_PER_TICK],
    )
    claimed = []
    stamp = iso(now())
    lease_expiry = iso(now() + timedelta(seconds=LEASE_SECONDS))
    for row in due_rows:
        rs = await q(
            "UPDATE ea_execution SET status = 'running', claimedBy = ?, claimedAt = ?, leaseExpiresAt = ?,"
            " attempts = attempts + 1, updatedAt = ?"
            " WHERE id = ? AND status = 'pending'",
            [_worker_id, stamp, lease_expiry, stamp, row["id"]],
        )
        if rs.rows_affected and rs.rows_affected > 0:
            full = await q_rows("SELECT * FROM ea_execution WHERE id = ?", [row["id"]])
            if full:
                claimed.append(full[0])
    return claimed


async def reclaim_expired_leases():
    stamp = iso(now())
    await q(
        "UPDATE ea_execution SET status = 'pending', claimedBy = NULL, leaseExpiresAt = NULL, updatedAt = ?"
        " WHERE status = 'running' AND leaseExpiresAt IS NOT NULL AND leaseExpiresAt < ?",
        [stamp, stamp],
    )


async def tick() -> Dict[str, int]:
    await reclaim_expired_leases()
    jobs = await claim_jobs()
    stats = {"claimed": len(jobs), "done": 0, "failed": 0, "requeued": 0}
    stamp = iso(now())
    for job in jobs:
        executor = EXECUTORS.get(job.get("type"))
        if not executor:
            await q("UPDATE ea_execution SET status='dead', lastError='unknown type', updatedAt = ? WHERE id = ?",
                    [stamp, job["id"]])
            continue
        try:
            outcome = await asyncio.wait_for(executor(job), timeout=JOB_TIMEOUT_SECONDS)
            if outcome == "failed":
                raise RuntimeError("executor reported failure")
            await q("UPDATE ea_execution SET status = 'done', updatedAt = ? WHERE id = ?", [stamp, job["id"]])
            stats["done"] += 1
        except Exception as e:
            attempts = (job.get("attempts") or 1)
            max_attempts = job.get("maxAttempts") or 3
            err = str(e)[:300]
            if attempts < max_attempts:
                backoff = RETRY_BACKOFF[min(attempts - 1, len(RETRY_BACKOFF) - 1)]
                run_at = iso(now() + timedelta(seconds=backoff))
                await q(
                    "UPDATE ea_execution SET status = 'pending', lastError = ?, runAt = ?,"
                    " claimedBy = NULL, leaseExpiresAt = NULL, updatedAt = ? WHERE id = ?",
                    [err, run_at, stamp, job["id"]],
                )
                stats["requeued"] += 1
                log.warning(f"job {job['id']} attempt {attempts} failed, requeued in {backoff}s: {err[:120]}")
            else:
                await q("UPDATE ea_execution SET status = 'dead', lastError = ?, updatedAt = ? WHERE id = ?",
                        [err, stamp, job["id"]])
                stats["failed"] += 1
                log.error(f"job {job['id']} dead after {attempts} attempts: {err[:120]}")
    try:
        await sweep_campaigns()
    except Exception as e:
        log.warning(f"campaign sweep failed: {e}")
    return stats


async def worker_loop():
    log.info(f"worker {_worker_id} started (tick={TICK_INTERVAL_SECONDS}s, batch={MAX_JOBS_PER_TICK})")
    while True:
        try:
            stats = await tick()
            if stats["claimed"]:
                log.info(f"tick: {stats}")
        except asyncio.CancelledError:
            break
        except Exception as e:
            log.error(f"tick error: {e}")
        await asyncio.sleep(TICK_INTERVAL_SECONDS)


@app.on_event("startup")
async def startup():
    global _worker_task
    _worker_task = asyncio.create_task(worker_loop())


@app.on_event("shutdown")
async def shutdown():
    if _worker_task:
        _worker_task.cancel()


# ─────────────────────── HTTP API ───────────────────────────

def require_secret(x_engine_secret: str):
    if x_engine_secret != ENGINE_SECRET:
        raise HTTPException(status_code=401, detail="Invalid engine secret")


class TestSend(BaseModel):
    channel: str = "email"
    to: str
    subject: str = "Test message"
    bodyHtml: str = ""
    bodyText: str = ""


@app.get("/health")
async def health():
    return {"status": "ok", "service": "automation-engine", "worker": _worker_id}


@app.get("/status")
async def status(x_engine_secret: str = Header(default="")):
    require_secret(x_engine_secret)
    pending = await q_rows("SELECT COUNT(*) AS n FROM ea_execution WHERE status = 'pending'")
    running = await q_rows("SELECT COUNT(*) AS n FROM ea_execution WHERE status = 'running'")
    dead = await q_rows("SELECT COUNT(*) AS n FROM ea_execution WHERE status = 'dead'")
    return {
        "status": "online",
        "worker": _worker_id,
        "tickInterval": TICK_INTERVAL_SECONDS,
        "queue": {
            "pending": pending[0]["n"], "running": running[0]["n"], "dead": dead[0]["n"],
        },
    }


@app.post("/tick")
async def tick_endpoint(x_engine_secret: str = Header(default="")):
    require_secret(x_engine_secret)
    stats = await tick()
    return {"ok": True, "stats": stats}


@app.post("/test-send")
async def test_send(body: TestSend, x_engine_secret: str = Header(default="")):
    require_secret(x_engine_secret)
    job_id = f"exe_{uuid.uuid4().hex[:20]}"
    stamp = iso(now())
    await q(
        "INSERT INTO ea_execution (id, workspaceId, type, status, priority, payload, runAt, createdAt, updatedAt)"
        " VALUES (?, ?, 'send_single', 'pending', 0, ?, ?, ?, ?)",
        [job_id, "engine-local", json.dumps({
            "channel": body.channel, "to": body.to, "subject": body.subject,
            "bodyHtml": body.bodyHtml, "bodyText": body.bodyText, "isTest": True,
        }), stamp, stamp, stamp],
    )
    # execute immediately for snappy UX
    job = (await q_rows("SELECT * FROM ea_execution WHERE id = ?", [job_id]))[0]
    outcome = await asyncio.wait_for(EXECUTORS["send_single"](job), timeout=JOB_TIMEOUT_SECONDS)
    await q("UPDATE ea_execution SET status='done', updatedAt = ? WHERE id = ?", [stamp, job_id])
    return {"ok": True, "outcome": outcome}
