import { db } from "@/lib/db";
import { handleRoute, ok, withAuth, parseBody, notFound, clampLimit } from "@/lib/api-helpers";
import { campaignUpdateSchema } from "@/lib/contracts";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const { id } = await params;
      const url = new URL(req.url);
      const messagesLimit = clampLimit(url.searchParams.get("messagesLimit"), 20);

      const campaign = await db.campaign.findFirst({
        where: { id, workspaceId: ctx.workspaceId },
        include: { list: { select: { id: true, name: true } } },
      });
      if (!campaign) return notFound("Campaign");

      const [byStatus, messages, recentEvents] = await Promise.all([
        db.message.groupBy({
          by: ["status"],
          where: { campaignId: id, workspaceId: ctx.workspaceId },
          _count: { _all: true },
        }),
        db.message.findMany({
          where: { campaignId: id, workspaceId: ctx.workspaceId },
          orderBy: { createdAt: "desc" },
          take: messagesLimit,
          select: {
            id: true, channel: true, toAddress: true, subject: true, status: true,
            provider: true, error: true, sentAt: true, openedAt: true, clickedAt: true,
            contact: { select: { id: true, email: true, firstName: true, lastName: true } },
          },
        }),
        db.event.findMany({
          where: { campaignId: id, workspaceId: ctx.workspaceId },
          orderBy: { createdAt: "desc" },
          take: 30,
        }),
      ]);

      const stats: Record<string, number> = {};
      for (const s of byStatus) stats[s.status] = s._count._all;

      return ok({
        campaign: { ...campaign, segmentRules: JSON.parse(campaign.segmentRules) },
        stats,
        messages,
        events: recentEvents.map((e) => ({ ...e, metadata: JSON.parse(e.metadata) })),
      });
    })
  );
}

export async function PATCH(req: Request, { params }: Params) {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const { id } = await params;
      const existing = await db.campaign.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
      if (!existing) return notFound("Campaign");
      const parsed = await parseBody(req, campaignUpdateSchema);
      if (!parsed.ok) return parsed.response;
      const { segmentRules, ...fields } = parsed.data;
      const campaign = await db.campaign.update({
        where: { id },
        data: {
          ...fields,
          ...(segmentRules ? { segmentRules: JSON.stringify(segmentRules) } : {}),
        },
      });
      return ok({ campaign });
    })
  );
}

export async function DELETE(_req: Request, { params }: Params) {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const { id } = await params;
      const existing = await db.campaign.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
      if (!existing) return notFound("Campaign");
      await db.campaign.delete({ where: { id } });
      return ok({ deleted: id });
    })
  );
}
