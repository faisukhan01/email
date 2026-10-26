import { handleRoute, ok, fail } from "@/lib/api-helpers";
import { ENGINE_SECRET } from "@/lib/engine";

export const dynamic = "force-dynamic";

/** Proxy to the FastAPI automation engine status. */
export async function GET() {
  return handleRoute(async () => {
    try {
      const res = await fetch(`${process.env.ENGINE_URL ?? "http://localhost:3030"}/status`, {
        headers: { "X-Engine-Secret": ENGINE_SECRET },
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) throw new Error(`engine responded ${res.status}`);
      const data = await res.json();
      return ok({ engine: data, reachable: true });
    } catch {
      return ok({
        reachable: false,
        engine: { status: "offline", hint: "The automation engine mini-service is not running." },
      });
    }
  });
}

/** Manually triggers an engine tick (useful right after enqueueing work). */
export async function POST() {
  return handleRoute(async () => {
    try {
      const res = await fetch(`${process.env.ENGINE_URL ?? "http://localhost:3030"}/tick`, {
        method: "POST",
        headers: { "X-Engine-Secret": ENGINE_SECRET },
        signal: AbortSignal.timeout(30000),
      });
      const data = await res.json();
      return ok({ tick: data, reachable: true });
    } catch {
      return fail("UPSTREAM_FAILURE", "Automation engine unreachable", {
        remediation: "The engine processes queued work automatically every 15 seconds.",
        details: { retryable: true },
      });
    }
  });
}
