import { db } from "@/lib/db";
import { handleRoute, ok, withAuth, parseBody, notFound } from "@/lib/api-helpers";
import { listUpsertSchema } from "@/lib/contracts";

export const dynamic = "force-dynamic";

export async function GET() {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const lists = await db.list.findMany({
        where: { workspaceId: ctx.workspaceId },
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { contacts: true } } },
      });
      return ok({ lists });
    })
  );
}

export async function POST(req: Request) {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const parsed = await parseBody(req, listUpsertSchema);
      if (!parsed.ok) return parsed.response;
      const list = await db.list.create({ data: { ...parsed.data, workspaceId: ctx.workspaceId } });
      return ok({ list }, { status: 201 });
    })
  );
}
