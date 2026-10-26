import { db } from "@/lib/db";
import { handleRoute, ok, withAuth, parseBody, notFound } from "@/lib/api-helpers";
import { dealUpdateSchema } from "@/lib/contracts";
import { recordEvent } from "@/lib/messaging";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const { id } = await params;
      const existing = await db.deal.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
      if (!existing) return notFound("Deal");
      const parsed = await parseBody(req, dealUpdateSchema);
      if (!parsed.ok) return parsed.response;
      const { expectedCloseAt, ...fields } = parsed.data;

      const stageChanged = fields.stage && fields.stage !== existing.stage;
      const deal = await db.deal.update({
        where: { id },
        data: {
          ...fields,
          expectedCloseAt: expectedCloseAt ? new Date(expectedCloseAt) : undefined,
          ...(stageChanged
            ? {
                closedAt: ["won", "lost"].includes(fields.stage ?? "") ? new Date() : null,
                probability:
                  fields.stage === "won" ? 100 : fields.stage === "lost" ? 0 : undefined,
              }
            : {}),
        },
      });

      if (stageChanged) {
        await db.activity.create({
          data: {
            workspaceId: ctx.workspaceId,
            contactId: deal.contactId,
            dealId: deal.id,
            type: "deal_stage",
            title: `Stage: ${existing.stage} → ${deal.stage}`,
          },
        });
        await recordEvent({
          workspaceId: ctx.workspaceId,
          type: "deal.stage_changed",
          metadata: { dealId: id, from: existing.stage, to: deal.stage, value: deal.value },
        });
      }
      return ok({ deal });
    })
  );
}

export async function DELETE(_req: Request, { params }: Params) {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const { id } = await params;
      const existing = await db.deal.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
      if (!existing) return notFound("Deal");
      await db.deal.delete({ where: { id } });
      return ok({ deleted: id });
    })
  );
}
