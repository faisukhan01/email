import { db } from "@/lib/db";
import { handleRoute, ok, withAuth, parseBody, notFound } from "@/lib/api-helpers";
import { segmentUpsertSchema } from "@/lib/contracts";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const { id } = await params;
      const existing = await db.segment.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
      if (!existing) return notFound("Segment");
      const parsed = await parseBody(req, segmentUpsertSchema);
      if (!parsed.ok) return parsed.response;
      const segment = await db.segment.update({
        where: { id },
        data: { ...parsed.data, rules: JSON.stringify(parsed.data.rules) },
      });
      return ok({ segment });
    })
  );
}

export async function DELETE(_req: Request, { params }: Params) {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const { id } = await params;
      const existing = await db.segment.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
      if (!existing) return notFound("Segment");
      await db.segment.delete({ where: { id } });
      return ok({ deleted: id });
    })
  );
}
