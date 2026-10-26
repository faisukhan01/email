import { db } from "@/lib/db";
import { handleRoute, ok, withAuth, parseBody } from "@/lib/api-helpers";
import { templateUpsertSchema } from "@/lib/contracts";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const url = new URL(req.url);
      const channel = url.searchParams.get("channel");
      const templates = await db.template.findMany({
        where: { workspaceId: ctx.workspaceId, ...(channel ? { channel } : {}) },
        orderBy: { updatedAt: "desc" },
      });
      return ok({ templates });
    })
  );
}

export async function POST(req: Request) {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const parsed = await parseBody(req, templateUpsertSchema);
      if (!parsed.ok) return parsed.response;
      const template = await db.template.create({
        data: { ...parsed.data, workspaceId: ctx.workspaceId, variables: JSON.stringify(parsed.data.variables ?? []) },
      });
      return ok({ template }, { status: 201 });
    })
  );
}
