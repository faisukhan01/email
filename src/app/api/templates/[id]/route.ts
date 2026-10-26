import { db } from "@/lib/db";
import { handleRoute, ok, withAuth, parseBody, notFound } from "@/lib/api-helpers";
import { templateUpsertSchema } from "@/lib/contracts";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const { id } = await params;
      const existing = await db.template.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
      if (!existing) return notFound("Template");
      const parsed = await parseBody(req, templateUpsertSchema);
      if (!parsed.ok) return parsed.response;
      const template = await db.template.update({
        where: { id },
        data: { ...parsed.data, variables: JSON.stringify(parsed.data.variables ?? []) },
      });
      return ok({ template });
    })
  );
}

export async function DELETE(_req: Request, { params }: Params) {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const { id } = await params;
      const existing = await db.template.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
      if (!existing) return notFound("Template");
      await db.template.delete({ where: { id } });
      return ok({ deleted: id });
    })
  );
}
