import { db } from "@/lib/db";
import { handleRoute, ok, withAuth, parseBody } from "@/lib/api-helpers";
import { dealCreateSchema } from "@/lib/contracts";
import { recordEvent } from "@/lib/messaging";

export const dynamic = "force-dynamic";

export async function GET() {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const deals = await db.deal.findMany({
        where: { workspaceId: ctx.workspaceId },
        orderBy: [{ position: "asc" }, { updatedAt: "desc" }],
        include: {
          contact: { select: { id: true, email: true, firstName: true, lastName: true, company: true } },
        },
      });
      return ok({ deals });
    })
  );
}

export async function POST(req: Request) {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const parsed = await parseBody(req, dealCreateSchema);
      if (!parsed.ok) return parsed.response;
      const { expectedCloseAt, ...fields } = parsed.data;
      const count = await db.deal.count({ where: { workspaceId: ctx.workspaceId, stage: fields.stage ?? "new" } });
      const deal = await db.deal.create({
        data: {
          ...fields,
          workspaceId: ctx.workspaceId,
          expectedCloseAt: expectedCloseAt ? new Date(expectedCloseAt) : null,
          position: count,
        },
      });
      if (deal.contactId) {
        await db.activity.create({
          data: {
            workspaceId: ctx.workspaceId,
            contactId: deal.contactId,
            dealId: deal.id,
            type: "system",
            title: `Deal created: ${deal.title}`,
          },
        });
      }
      await recordEvent({
        workspaceId: ctx.workspaceId,
        type: "deal.created",
        metadata: { dealId: deal.id, value: deal.value },
      });
      return ok({ deal }, { status: 201 });
    })
  );
}
