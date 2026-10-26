import { db } from "@/lib/db";
import { handleRoute, ok, withAuth, parseBody, notFound } from "@/lib/api-helpers";
import { listUpsertSchema } from "@/lib/contracts";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const { id } = await params;
      const existing = await db.list.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
      if (!existing) return notFound("List");
      const parsed = await parseBody(req, listUpsertSchema);
      if (!parsed.ok) return parsed.response;
      const list = await db.list.update({ where: { id }, data: parsed.data });
      return ok({ list });
    })
  );
}

export async function DELETE(_req: Request, { params }: Params) {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const { id } = await params;
      const existing = await db.list.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
      if (!existing) return notFound("List");
      await db.list.delete({ where: { id } });
      return ok({ deleted: id });
    })
  );
}
