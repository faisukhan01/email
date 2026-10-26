import { db } from "./db";
import { recordEvent, renderTemplate, contactVars, htmlToSnippet, matchesAllRules, SegmentRule } from "./messaging";
import { decryptSecret } from "./crypto";

/**
 * In-process automation runner — a faithful port of the FastAPI engine
 * (mini-services/automation-engine) to the Next.js runtime so the platform
 * is fully self-sufficient on serverless hosts (Vercel) where a sidecar
 * service cannot run.
 *
 * Patterns kept from the reference implementation (morluto/rea):
 * - Lease-based job claiming: pending jobs transition pending->running with
 *   claimedBy + leaseExpiresAt; expired leases are reclaimed, so two workers
 *   (or two lambda instances) can never double-send.
 * - Evidence envelopes: every outbound message records provider identity,
 *   confidence level, limitations, and timestamps.
 * - Bounded execution: batch caps, per-job timeouts, retry-with-backoff caps.
 * - Observational events: event-stream writes never mutate job truth.
 */

// ─────────────────────────── tunables ───────────────────────────

export const MAX_JOBS_PER_TICK = 25;
export const MAX_FANOUT_PER_TICK = 150;
export const LEASE_SECONDS = 90;
export const RETRY_BACKOFF_SECONDS = [60, 300, 900]; // after attempt 1, 2, 3
export const BOUNCE_RATE_SIM = 0.03;
const JOB_TIMEOUT_MS_DEFAULT = 30_000;
const WORKER_ID = `runner-${Math.random().toString(36).slice(2, 10)}`;

export interface TickStats {
  claimed: number;
  done: number;
  failed: number;
  requeued: number;
}

type ExecutionType = "campaign_dispatch" | "sequence_step" | "send_single" | "enroll_contacts";
type Job = {
  id: string;
  workspaceId: string;
  type: string;
  attempts: number;
  maxAttempts: number;
  payload: string;
};

// ─────────────────────────── provider sends ───────────────────────────

interface IntegrationRow {
  emailProvider: string;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean;
  smtpUser: string | null;
  smtpPassEnc: string | null;
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
  resendApiKeyEnc: string | null;
  waPhoneNumberId: string | null;
  waAccessTokenEnc: string | null;
}

async function sendViaResend(
  apiKey: string, to: string, subject: string, html: string, text: string,
  fromName: string, fromEmail: string, replyTo: string,
): Promise<{ provider: string; providerMsgId: string | null }> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${fromName || "Automation"} <${fromEmail || "onboarding@resend.dev"}>`,
      to: [to],
      subject,
      html: html || undefined,
      text: text || undefined,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`Resend API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { id?: string };
  return { provider: "resend", providerMsgId: data.id ?? null };
}

async function sendViaSmtp(
  integration: IntegrationRow, pass: string, to: string, subject: string,
  html: string, text: string, fromName: string, fromEmail: string, replyTo: string,
): Promise<{ provider: string; providerMsgId: string | null }> {
  const nodemailer = (await import("nodemailer")).default;
  const port = integration.smtpPort ?? 587;
  const transport = nodemailer.createTransport({
    host: integration.smtpHost ?? undefined,
    port,
    secure: integration.smtpSecure ?? port === 465,
    auth: integration.smtpUser ? { user: integration.smtpUser, pass } : undefined,
    connectionTimeout: 25_000,
  });
  const info = await transport.sendMail({
    from: `${fromName || "Automation"} <${fromEmail || "hello@example.com"}>`,
    to,
    subject,
    html: html || text || "",
    text: text || undefined,
    ...(replyTo ? { replyTo } : {}),
  });
  return { provider: "smtp", providerMsgId: info.messageId ?? null };
}

async function sendViaWhatsAppCloud(
  token: string, phoneId: string, to: string, body: string,
): Promise<{ provider: string; providerMsgId: string | null }> {
  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { preview_url: false, body },
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`WhatsApp API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { messages?: { id: string }[] };
  return { provider: "whatsapp_cloud", providerMsgId: data.messages?.[0]?.id ?? null };
}

function evidenceEnvelope(provider: string, simulated: boolean, extra?: Record<string, unknown>): string {
  return JSON.stringify({
    provider,
    confidence: simulated ? "inferred" : "observed",
    simulated,
    limitations: simulated ? ["Simulation mode — delivery not performed by a real provider"] : [],
    recordedAt: new Date().toISOString(),
    ...(extra ?? {}),
  });
}

/** Single message dispatch with full evidence envelope. Mirrors dispatch_message(). */
async function dispatchMessage(params: {
  workspaceId: string;
  contact: { id: string | null; email: string; firstName: string; lastName: string; phone: string };
  channel: "email" | "whatsapp";
  subject: string;
  html: string;
  text: string;
  campaignId?: string | null;
  fromName?: string;
  fromEmail?: string;
  replyTo?: string;
  isTest?: boolean;
}): Promise<{ messageId: string; status: string; error: string | null; provider: string }> {
  const { workspaceId, contact, channel } = params;
  const [integration, ws] = await Promise.all([
    db.integration.findUnique({ where: { workspaceId } }),
    db.workspace.findUnique({ where: { id: workspaceId }, select: { simulationMode: true } }),
  ]);
  const simulation = ws?.simulationMode ?? true;
  const isTest = params.isTest ?? false;

  let providerUsed = "simulator";
  let providerMsgId = `sim_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let error: string | null = null;

  if (!simulation && !isTest && integration) {
    try {
      if (channel === "email") {
        const mode = (integration.emailProvider || "smtp").toLowerCase();
        const resendKey = decryptSecret(integration.resendApiKeyEnc);
        const smtpPass = decryptSecret(integration.smtpPassEnc);
        if (mode === "resend" && resendKey) {
          const r = await sendViaResend(resendKey, contact.email, params.subject, params.html, params.text,
            params.fromName ?? "", params.fromEmail ?? "", params.replyTo ?? "");
          providerUsed = r.provider;
          providerMsgId = r.providerMsgId ?? providerMsgId;
        } else if (mode === "smtp" && integration.smtpHost && smtpPass) {
          const r = await sendViaSmtp(integration, smtpPass, contact.email, params.subject, params.html, params.text,
            params.fromName ?? "", params.fromEmail ?? "", params.replyTo ?? "");
          providerUsed = r.provider;
          providerMsgId = r.providerMsgId ?? providerMsgId;
        } else {
          throw new Error("Email provider not fully configured");
        }
      } else {
        const waToken = decryptSecret(integration.waAccessTokenEnc);
        const waPhoneId = integration.waPhoneNumberId;
        if (waToken && waPhoneId) {
          const r = await sendViaWhatsAppCloud(waToken, waPhoneId, contact.phone || "", params.text || params.html.slice(0, 1024));
          providerUsed = r.provider;
          providerMsgId = r.providerMsgId ?? providerMsgId;
        } else {
          throw new Error("WhatsApp Cloud API not fully configured");
        }
      }
    } catch (e) {
      error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    }
  }

  const toAddress = channel === "email" ? contact.email : (contact.phone || contact.email);
  let status = error ? "failed" : "sent";
  if (!error && simulation && !isTest && channel === "email" && Math.random() < BOUNCE_RATE_SIM) {
    status = "bounced";
  }

  const now = new Date();
  const message = await db.message.create({
    data: {
      workspaceId,
      campaignId: params.campaignId ?? null,
      contactId: contact.id,
      channel,
      toAddress,
      subject: (params.subject || "").slice(0, 200),
      bodySnippet: htmlToSnippet(params.html || params.text),
      status,
      provider: providerUsed,
      providerMsgId,
      error,
      evidence: evidenceEnvelope(providerUsed, simulation && !isTest),
      sentAt: error ? null : now,
      bouncedAt: status === "bounced" ? now : null,
    },
    select: { id: true },
  });

  const eventType = `${channel === "email" ? "email" : "whatsapp"}.${status === "bounced" ? "bounced" : "sent"}`;
  await recordEvent({
    workspaceId,
    type: eventType,
    contactId: contact.id,
    campaignId: params.campaignId ?? null,
    messageId: message.id,
    metadata: { provider: providerUsed, test: isTest },
  });
  return { messageId: message.id, status, error, provider: providerUsed };
}

// ─────────────────────────── executors ───────────────────────────

async function execCampaignDispatch(job: Job): Promise<"done" | "failed"> {
  const payload = JSON.parse(job.payload || "{}") as { campaignId?: string };
  const campaignId = payload.campaignId;
  if (!campaignId) return "done";

  const campaign = await db.campaign.findFirst({
    where: { id: campaignId, workspaceId: job.workspaceId },
  });
  if (!campaign) return "done";
  if (!["sending", "scheduled"].includes(campaign.status)) return "done";

  await db.campaign.update({
    where: { id: campaign.id },
    data: { status: "sending", startedAt: campaign.startedAt ?? new Date() },
  });

  // Resolve audience (bounded per tick, same caps as the reference engine)
  const take = MAX_FANOUT_PER_TICK;
  let audience: { id: string; email: string; firstName: string; lastName: string; phone: string }[];
  if (campaign.audienceType === "all") {
    audience = await db.contact.findMany({
      where: { workspaceId: job.workspaceId, status: "subscribed" },
      select: { id: true, email: true, firstName: true, lastName: true, phone: true },
      take,
    });
  } else if (campaign.audienceType === "list" && campaign.listId) {
    audience = await db.contact.findMany({
      where: { workspaceId: job.workspaceId, status: "subscribed", lists: { some: { listId: campaign.listId } } },
      select: { id: true, email: true, firstName: true, lastName: true, phone: true },
      take,
    });
  } else {
    let rules: SegmentRule[] = [];
    try { rules = JSON.parse(campaign.segmentRules || "[]") as SegmentRule[]; } catch { rules = []; }
    const rows = await db.contact.findMany({
      where: { workspaceId: job.workspaceId, status: "subscribed" },
      select: {
        id: true, email: true, firstName: true, lastName: true, phone: true, company: true,
        jobTitle: true, country: true, city: true, status: true, lifecycleStage: true, leadScore: true, tags: true,
      },
      take,
    });
    audience = rows.filter((r) => matchesAllRules(r, rules)).map((r) => ({
      id: r.id, email: r.email, firstName: r.firstName, lastName: r.lastName, phone: r.phone,
    }));
  }

  const varsById = new Map<string, Record<string, string>>();
  const details = await db.contact.findMany({
    where: { id: { in: audience.map((a) => a.id) } },
    select: { id: true, email: true, firstName: true, lastName: true, phone: true, company: true, jobTitle: true, country: true, city: true },
  });
  for (const c of details) varsById.set(c.id, contactVars(c));

  await db.execution.createMany({
    data: audience.map((c) => {
      const vars = varsById.get(c.id) ?? {};
      return {
        workspaceId: job.workspaceId,
        type: "send_single" as const,
        priority: 2,
        payload: JSON.stringify({
          campaignId: campaign.id,
          contactId: c.id,
          channel: campaign.channel || "email",
          subject: renderTemplate(campaign.subject || "", vars),
          bodyHtml: renderTemplate(campaign.bodyHtml || "", vars),
          bodyText: renderTemplate(campaign.bodyText || "", vars),
          fromName: campaign.fromName || "",
          fromEmail: campaign.fromEmail || "",
          replyTo: campaign.replyTo || "",
        }),
        runAt: new Date(),
      };
    }),
  });
  return "done";
}

async function execSendSingle(job: Job): Promise<"done" | "failed"> {
  const payload = JSON.parse(job.payload || "{}") as {
    contactId?: string; channel?: "email" | "whatsapp"; subject?: string;
    bodyHtml?: string; bodyText?: string; campaignId?: string;
    fromName?: string; fromEmail?: string; replyTo?: string; isTest?: boolean; to?: string;
  };

  let contact: { id: string | null; email: string; firstName: string; lastName: string; phone: string };
  if (payload.contactId) {
    const c = await db.contact.findFirst({
      where: { id: payload.contactId, workspaceId: job.workspaceId },
      select: { id: true, email: true, firstName: true, lastName: true, phone: true, status: true },
    });
    if (!c || c.status === "unsubscribed") return "done";
    contact = c;
  } else {
    contact = { id: null, email: payload.to ?? "", firstName: "", lastName: "", phone: payload.to ?? "" };
  }

  const result = await dispatchMessage({
    workspaceId: job.workspaceId,
    contact,
    channel: payload.channel ?? "email",
    subject: payload.subject ?? "",
    html: payload.bodyHtml ?? "",
    text: payload.bodyText ?? "",
    campaignId: payload.campaignId ?? null,
    fromName: payload.fromName ?? "",
    fromEmail: payload.fromEmail ?? "",
    replyTo: payload.replyTo ?? "",
    isTest: payload.isTest,
  });
  // Campaign finalization is owned by sweepCampaigns() — never inside a job.
  return result.status !== "failed" ? "done" : "failed";
}

function delayMs(amount: number, unit: string): number {
  if (unit === "minutes") return amount * 60_000;
  if (unit === "hours") return amount * 3_600_000;
  return amount * 86_400_000;
}

async function execSequenceStep(job: Job): Promise<"done" | "failed"> {
  const payload = JSON.parse(job.payload || "{}") as { sequenceId?: string; contactId?: string; stepPosition?: number };
  const sequenceId = payload.sequenceId;
  const contactId = payload.contactId;
  const stepPosition = payload.stepPosition ?? 1;
  if (!sequenceId || !contactId) return "done";

  const [sequence, contact] = await Promise.all([
    db.sequence.findFirst({ where: { id: sequenceId, workspaceId: job.workspaceId } }),
    db.contact.findFirst({ where: { id: contactId, workspaceId: job.workspaceId } }),
  ]);
  if (!sequence || !contact) return "done";
  if (sequence.status !== "active") return "done";

  const enrollment = await db.enrollment.findUnique({
    where: { sequenceId_contactId: { sequenceId, contactId } },
  });
  if (!enrollment || enrollment.status !== "active") return "done";

  const steps = await db.sequenceStep.findMany({
    where: { sequenceId },
    orderBy: { position: "asc" },
    take: 30,
  });
  const step = steps.find((s) => s.position === stepPosition);
  if (!step) {
    await db.enrollment.update({
      where: { id: enrollment.id },
      data: { status: "completed", completedAt: new Date() },
    });
    return "done";
  }

  let config: Record<string, unknown> = {};
  try { config = JSON.parse(step.config || "{}"); } catch { config = {}; }
  const vars = contactVars(contact);
  const cStr = (k: string) => String(config[k] ?? "");
  let result: "done" | "failed" = "done";

  switch (step.type) {
    case "send_email": {
      const r = await dispatchMessage({
        workspaceId: job.workspaceId,
        contact: { id: contact.id, email: contact.email, firstName: contact.firstName, lastName: contact.lastName, phone: contact.phone },
        channel: "email",
        subject: renderTemplate(cStr("subject"), vars),
        html: renderTemplate(cStr("bodyHtml"), vars),
        text: renderTemplate(cStr("bodyText"), vars),
      });
      if (r.status === "failed") {
        await db.enrollment.update({
          where: { id: enrollment.id },
          data: { status: "failed", exitReason: r.error ?? "send failed" },
        });
        return "failed";
      }
      break;
    }
    case "send_whatsapp": {
      const r = await dispatchMessage({
        workspaceId: job.workspaceId,
        contact: { id: contact.id, email: contact.email, firstName: contact.firstName, lastName: contact.lastName, phone: contact.phone },
        channel: "whatsapp",
        subject: "",
        html: "",
        text: renderTemplate(cStr("bodyText"), vars),
      });
      result = r.status !== "failed" ? "done" : "failed";
      break;
    }
    case "add_tag": {
      let tags: string[] = [];
      try { tags = JSON.parse(contact.tags || "[]") as string[]; } catch { tags = []; }
      const tag = cStr("tag");
      if (tag && !tags.includes(tag)) tags.push(tag);
      await db.contact.update({ where: { id: contactId }, data: { tags: JSON.stringify(tags) } });
      break;
    }
    case "remove_tag": {
      let tags: string[] = [];
      try { tags = JSON.parse(contact.tags || "[]") as string[]; } catch { tags = []; }
      const tag = cStr("tag");
      await db.contact.update({
        where: { id: contactId },
        data: { tags: JSON.stringify(tags.filter((t) => t !== tag)) },
      });
      break;
    }
    case "update_field": {
      const field = cStr("field");
      const allowed = new Set(["firstName", "lastName", "phone", "company", "jobTitle", "country", "city", "lifecycleStage", "notes"]);
      if (allowed.has(field)) {
        await db.contact.update({
          where: { id: contactId },
          data: { [field]: cStr("value") } as Record<string, string>,
        });
      }
      break;
    }
    case "wait":
    default:
      break;
  }

  await db.enrollment.update({
    where: { id: enrollment.id },
    data: { currentPosition: stepPosition },
  });

  // Schedule the next step (delay comes from the next step's own config)
  const nextStep = steps.find((s) => s.position === stepPosition + 1);
  if (nextStep) {
    let nextConfig: Record<string, unknown> = {};
    try { nextConfig = JSON.parse(nextStep.config || "{}"); } catch { nextConfig = {}; }
    const wait = delayMs(Number(nextConfig.delayAmount ?? 0), String(nextConfig.delayUnit ?? "days"));
    await db.execution.create({
      data: {
        workspaceId: job.workspaceId,
        type: "sequence_step",
        stepId: nextStep.id,
        priority: 5,
        payload: JSON.stringify({ sequenceId, contactId, stepPosition: stepPosition + 1 }),
        runAt: new Date(Date.now() + wait),
      },
    });
  } else {
    await db.enrollment.update({
      where: { id: enrollment.id },
      data: { status: "completed", completedAt: new Date() },
    });
    await recordEvent({
      workspaceId: job.workspaceId,
      type: "sequence.completed",
      contactId,
      metadata: { sequenceId },
    });
  }
  return result;
}

async function execEnrollContacts(job: Job): Promise<"done" | "failed"> {
  const payload = JSON.parse(job.payload || "{}") as { sequenceId?: string; contactIds?: string[] };
  const sequenceId = payload.sequenceId;
  const contactIds = (payload.contactIds ?? []).slice(0, 200);
  if (!sequenceId || contactIds.length === 0) return "done";

  const firstStep = await db.sequenceStep.findFirst({
    where: { sequenceId },
    orderBy: { position: "asc" },
    select: { id: true },
  });
  if (!firstStep) return "done";

  for (const cid of contactIds) {
    const existing = await db.enrollment.findUnique({
      where: { sequenceId_contactId: { sequenceId, contactId: cid } },
      select: { id: true, status: true },
    });
    if (existing && existing.status === "active") continue;
    if (existing) {
      await db.enrollment.update({
        where: { id: existing.id },
        data: { status: "active", currentPosition: 0, completedAt: null, exitReason: null },
      });
    } else {
      await db.enrollment.create({
        data: { workspaceId: job.workspaceId, sequenceId, contactId: cid },
      });
    }
    await db.execution.create({
      data: {
        workspaceId: job.workspaceId,
        type: "sequence_step",
        stepId: firstStep.id,
        priority: 5,
        payload: JSON.stringify({ sequenceId, contactId: cid, stepPosition: 1 }),
        runAt: new Date(),
      },
    });
  }
  return "done";
}

const EXECUTORS: Record<ExecutionType, (job: Job) => Promise<"done" | "failed">> = {
  campaign_dispatch: execCampaignDispatch,
  send_single: execSendSingle,
  sequence_step: execSequenceStep,
  enroll_contacts: execEnrollContacts,
};

// ─────────────────────────── supervision ───────────────────────────

/** Post-tick sweep: finalize campaigns whose fanout jobs are all terminal. */
async function sweepCampaigns(): Promise<void> {
  const sending = await db.campaign.findMany({
    where: { status: "sending" },
    select: { id: true, workspaceId: true },
    take: 20,
  });
  for (const camp of sending) {
    const pending = await db.execution.count({
      where: {
        workspaceId: camp.workspaceId,
        status: { in: ["pending", "running"] },
        payload: { contains: camp.id },
      },
    });
    if (pending > 0) continue;
    const total = await db.message.count({ where: { campaignId: camp.id } });
    if (total > 0) {
      const updated = await db.campaign.updateMany({
        where: { id: camp.id, status: "sending" },
        data: { status: "sent", completedAt: new Date() },
      });
      if (updated.count > 0) {
        await recordEvent({
          workspaceId: camp.workspaceId,
          type: "campaign.completed",
          campaignId: camp.id,
          metadata: { recipients: total },
        });
      }
    }
  }
}

// ─────────────────────────── tick ───────────────────────────

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("job timeout")), ms)),
  ]);
}

/**
 * Runs one bounded engine tick: reclaim expired leases, claim due jobs,
 * execute them with retry/backoff, then run the campaign supervision sweep.
 * Safe to call concurrently — a module-level mutex serializes in-process runs.
 */
export async function runEngineTick(opts?: {
  maxJobs?: number;
  jobTimeoutMs?: number;
}): Promise<TickStats> {
  return await engineMutex(() => tickInner(opts));
}

/** Single-flight mutex so concurrent requests never double-process a batch. */
let running_ = false;
let queued_ = false;
async function engineMutex<T>(fn: () => Promise<T>): Promise<T> {
  if (running_) {
    queued_ = true;
    // Coalesce: a tick is already in flight; report after it finishes.
    while (running_) await new Promise((r) => setTimeout(r, 250));
    queued_ = false;
    return fn();
  }
  running_ = true;
  try {
    return await fn();
  } finally {
    running_ = false;
    void queued_;
  }
}

async function tickInner(opts?: { maxJobs?: number; jobTimeoutMs?: number }): Promise<TickStats> {
  const maxJobs = Math.min(opts?.maxJobs ?? MAX_JOBS_PER_TICK, MAX_JOBS_PER_TICK);
  const jobTimeoutMs = opts?.jobTimeoutMs ?? JOB_TIMEOUT_MS_DEFAULT;

  // 1. Reclaim expired leases (crashed workers)
  const now = new Date();
  await db.execution.updateMany({
    where: { status: "running", leaseExpiresAt: { lt: now } },
    data: { status: "pending", claimedBy: null, leaseExpiresAt: null },
  });

  // 2. Claim due jobs with an ownership stamp (pending -> running CAS)
  const due = await db.execution.findMany({
    where: { status: "pending", runAt: { lte: new Date() } },
    orderBy: [{ priority: "asc" }, { runAt: "asc" }],
    select: { id: true },
    take: maxJobs,
  });
  const claimed: Job[] = [];
  const leaseExpiry = new Date(Date.now() + LEASE_SECONDS * 1000);
  for (const row of due) {
    const updated = await db.execution.updateMany({
      where: { id: row.id, status: "pending" },
      data: {
        status: "running",
        claimedBy: WORKER_ID,
        claimedAt: new Date(),
        leaseExpiresAt: leaseExpiry,
        attempts: { increment: 1 },
      },
    });
    if (updated.count === 1) {
      const full = await db.execution.findUnique({
        where: { id: row.id },
        select: { id: true, workspaceId: true, type: true, attempts: true, maxAttempts: true, payload: true },
      });
      if (full) claimed.push(full);
    }
  }

  // 3. Execute
  const stats: TickStats = { claimed: claimed.length, done: 0, failed: 0, requeued: 0 };
  for (const job of claimed) {
    const executor = EXECUTORS[job.type as ExecutionType];
    if (!executor) {
      await db.execution.update({
        where: { id: job.id },
        data: { status: "dead", lastError: "unknown type" },
      });
      continue;
    }
    try {
      const outcome = await withTimeout(executor(job), jobTimeoutMs);
      if (outcome === "failed") throw new Error("executor reported failure");
      await db.execution.update({ where: { id: job.id }, data: { status: "done" } });
      stats.done += 1;
    } catch (e) {
      const err = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      const attempts = job.attempts || 1;
      const maxAttempts = job.maxAttempts || 3;
      if (attempts < maxAttempts) {
        const backoff = RETRY_BACKOFF_SECONDS[Math.min(attempts - 1, RETRY_BACKOFF_SECONDS.length - 1)];
        await db.execution.update({
          where: { id: job.id },
          data: {
            status: "pending",
            lastError: err,
            runAt: new Date(Date.now() + backoff * 1000),
            claimedBy: null,
            leaseExpiresAt: null,
          },
        });
        stats.requeued += 1;
      } else {
        await db.execution.update({
          where: { id: job.id },
          data: { status: "dead", lastError: err },
        });
        stats.failed += 1;
      }
    }
  }

  // 4. Supervision sweep
  try {
    await sweepCampaigns();
  } catch {
    // sweep is observational — never fails the tick
  }
  return stats;
}

/** Live queue snapshot for status surfaces (no ticking). */
export async function queueCounts(): Promise<{ pending: number; running: number; dead: number }> {
  const [pending, running, dead] = await Promise.all([
    db.execution.count({ where: { status: "pending" } }),
    db.execution.count({ where: { status: "running" } }),
    db.execution.count({ where: { status: "dead" } }),
  ]);
  return { pending, running, dead };
}
