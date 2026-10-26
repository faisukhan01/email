import { handleRoute, ok, fail } from "@/lib/api-helpers";
import { ENGINE_SECRET } from "@/lib/engine";
import { runEngineTick, queueCounts } from "@/lib/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const EXTERNAL_TIMEOUT_MS = 4000;

function engineUrl(): string | null {
  const url = process.env.ENGINE_URL?.trim();
  return url ? url.replace(/\/$/, "") : null;
}

/**
 * Automation engine status.
 * - If ENGINE_URL is configured, the external engine service is probed first.
 * - If it is unreachable (or ENGINE_URL is not set), the platform reports its
 *   built-in in-process runner, which executes the same lease-based queue
 *   inside the Next.js runtime — this is what runs on Vercel.
 */
export async function GET() {
  return handleRoute(async () => {
    const base = engineUrl();
    if (base) {
      try {
        const res = await fetch(`${base}/status`, {
          headers: { "X-Engine-Secret": ENGINE_SECRET },
          signal: AbortSignal.timeout(EXTERNAL_TIMEOUT_MS),
        });
        if (res.ok) {
          const data = await res.json();
          return ok({ engine: data, reachable: true, mode: "external" });
        }
      } catch {
        // fall through to in-process runner
      }
    }
    const queue = await queueCounts();
    return ok({
      reachable: true,
      mode: "in-process",
      engine: {
        status: "online",
        worker: "in-process",
        tickInterval: 60,
        hint: base
          ? "External engine unreachable — the built-in in-process runner is handling the queue."
          : "Runs inside the Next.js server — no separate service required.",
        queue,
      },
    });
  });
}

/**
 * Manually triggers an engine tick. Uses the external engine when configured
 * and reachable; otherwise executes the tick in-process so queue processing
 * works identically on Vercel (where no sidecar service exists).
 */
export async function POST() {
  return handleRoute(async () => {
    const base = engineUrl();
    if (base) {
      try {
        const res = await fetch(`${base}/tick`, {
          method: "POST",
          headers: { "X-Engine-Secret": ENGINE_SECRET },
          signal: AbortSignal.timeout(30_000),
        });
        const data = await res.json();
        return ok({ tick: data, reachable: true, mode: "external" });
      } catch {
        // fall through to in-process tick
      }
    }
    const stats = await runEngineTick();
    return ok({
      tick: { ok: true, stats },
      reachable: true,
      mode: "in-process",
    });
  });
}
