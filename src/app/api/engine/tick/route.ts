import { NextResponse } from "next/server";
import { runEngineTick } from "@/lib/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Cron-friendly engine tick.
 *
 * Designed for Vercel Cron: when the CRON_SECRET env var is set, Vercel
 * automatically sends `Authorization: Bearer <CRON_SECRET>` on scheduled
 * invocations, and this route accepts it. The shared ENGINE_SECRET is also
 * accepted (bearer or x-engine-secret header) so self-hosted schedulers and
 * the external engine can drive ticks too.
 *
 * Fail-closed: in production, at least one secret must be configured.
 */
function authorized(req: Request): { ok: boolean; remediation?: string } {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const engineSecret = process.env.ENGINE_SECRET?.trim();
  const authHeader = req.headers.get("authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const xSecret = req.headers.get("x-engine-secret")?.trim() ?? "";

  if (cronSecret && bearer === cronSecret) return { ok: true };
  if (engineSecret && xSecret === engineSecret) return { ok: true };
  if (engineSecret && bearer === engineSecret) return { ok: true };

  // Local/dev convenience: no secrets configured at all, outside production.
  if (!cronSecret && !engineSecret && process.env.NODE_ENV !== "production") {
    return { ok: true };
  }
  return {
    ok: false,
    remediation: !cronSecret && !engineSecret
      ? "Set CRON_SECRET (recommended for Vercel Cron) or ENGINE_SECRET, then retry with the matching credential."
      : "Send 'Authorization: Bearer <CRON_SECRET>' or the 'x-engine-secret: <ENGINE_SECRET>' header.",
  };
}

async function tick(req: Request) {
  const gate = authorized(req);
  if (!gate.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "FORBIDDEN",
          message: "Invalid engine tick credentials",
          retryable: false,
          remediation: gate.remediation ?? "Provide a valid secret.",
        },
      },
      { status: 403 },
    );
  }
  try {
    const stats = await runEngineTick();
    return NextResponse.json({ ok: true, stats, mode: "in-process" });
  } catch (e) {
    console.error("[engine-tick]", e);
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INTERNAL",
          message: e instanceof Error ? e.message : "Engine tick failed",
          retryable: true,
          remediation: "The next scheduled tick will retry pending work automatically.",
        },
      },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  return tick(req);
}

export async function POST(req: Request) {
  return tick(req);
}
