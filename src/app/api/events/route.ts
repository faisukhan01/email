import { db } from "@/lib/db";
import { handleRoute, ok, withAuth, clampLimit } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

/** Unified activity feed across the workspace (bounded, newest first). */
export async function GET(req: Request) {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const url = new URL(req.url);
      const limit = clampLimit(url.searchParams.get("limit"), 30);
      const type = url.searchParams.get("type");

      const events = await db.event.findMany({
        where: { workspaceId: ctx.workspaceId, ...(type ? { type } : {}) },
        orderBy: { createdAt: "desc" },
        take: limit,
      });
      return ok({ events: events.map((e) => ({ ...e, metadata: JSON.parse(e.metadata) })) });
    })
  );
}
