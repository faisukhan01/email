import { db } from "@/lib/db";
import { handleRoute, ok, withAuth } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

/** Daily timeseries of message volume + engagement over the last N days. */
export async function GET(req: Request) {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const url = new URL(req.url);
      const days = Math.min(Math.max(Number(url.searchParams.get("days") ?? 14) || 14, 1), 90);
      const since = new Date(Date.now() - days * 24 * 3600 * 1000);
      since.setHours(0, 0, 0, 0);

      const messages = await db.message.findMany({
        where: { workspaceId: ctx.workspaceId, createdAt: { gte: since } },
        select: { createdAt: true, status: true, channel: true },
      });

      const buckets = new Map<string, { sent: number; opened: number; clicked: number; bounced: number }>();
      for (let i = 0; i < days; i++) {
        const d = new Date(since.getTime() + i * 24 * 3600 * 1000);
        buckets.set(d.toISOString().slice(0, 10), { sent: 0, opened: 0, clicked: 0, bounced: 0 });
      }
      for (const m of messages) {
        const key = m.createdAt.toISOString().slice(0, 10);
        const b = buckets.get(key);
        if (!b) continue;
        if (m.status !== "queued" && m.status !== "failed") b.sent++;
        if (["opened", "clicked", "replied"].includes(m.status)) b.opened++;
        if (["clicked", "replied"].includes(m.status)) b.clicked++;
        if (m.status === "bounced") b.bounced++;
      }

      const series = Array.from(buckets.entries()).map(([date, v]) => ({ date, ...v }));

      // Top campaigns by engagement
      const campaigns = await db.campaign.findMany({
        where: { workspaceId: ctx.workspaceId },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, name: true, channel: true, status: true },
      });
      const campStats = await db.message.groupBy({
        by: ["campaignId", "status"],
        where: { workspaceId: ctx.workspaceId, campaignId: { not: null } },
        _count: { _all: true },
      });
      const byCampaign = campaigns.map((c) => {
        const s: Record<string, number> = {};
        for (const st of campStats) {
          if (st.campaignId === c.id) s[st.status] = st._count._all;
        }
        return { ...c, stats: s };
      });

      return ok({ series, topCampaigns: byCampaign });
    })
  );
}
