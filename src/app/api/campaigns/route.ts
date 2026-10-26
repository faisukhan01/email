import { db } from "@/lib/db";
import { handleRoute, ok, withAuth, parseBody, clampLimit } from "@/lib/api-helpers";
import { campaignCreateSchema } from "@/lib/contracts";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const url = new URL(req.url);
      const limit = clampLimit(url.searchParams.get("limit"));
      const channel = url.searchParams.get("channel");
      const status = url.searchParams.get("status");

      const campaigns = await db.campaign.findMany({
        where: {
          workspaceId: ctx.workspaceId,
          ...(channel ? { channel } : {}),
          ...(status ? { status } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        include: {
          list: { select: { id: true, name: true } },
          _count: { select: { messages: true } },
        },
      });

      // Aggregate per-campaign message stats in one grouped query (bounded)
      const stats = await db.message.groupBy({
        by: ["campaignId", "status"],
        where: {
          workspaceId: ctx.workspaceId,
          campaignId: { in: campaigns.map((c) => c.id) },
        },
        _count: { _all: true },
      });

      const statsByCampaign = new Map<string, Record<string, number>>();
      for (const s of stats) {
        if (!s.campaignId) continue;
        const entry = statsByCampaign.get(s.campaignId) ?? {};
        entry[s.status] = s._count._all;
        statsByCampaign.set(s.campaignId, entry);
      }

      return ok({
        campaigns: campaigns.map((c) => ({
          ...c,
          stats: statsByCampaign.get(c.id) ?? {},
        })),
      });
    })
  );
}

export async function POST(req: Request) {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const parsed = await parseBody(req, campaignCreateSchema);
      if (!parsed.ok) return parsed.response;
      const integration = await db.integration.findUnique({ where: { workspaceId: ctx.workspaceId } });
      const campaign = await db.campaign.create({
        data: {
          ...parsed.data,
          workspaceId: ctx.workspaceId,
          fromName: parsed.data.fromName || integration?.fromName || "Automation Platform",
          fromEmail: parsed.data.fromEmail || integration?.fromEmail || "hello@example.com",
          segmentRules: JSON.stringify(parsed.data.segmentRules ?? []),
        },
      });
      return ok({ campaign }, { status: 201 });
    })
  );
}
