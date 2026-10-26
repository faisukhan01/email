import { db } from "@/lib/db";
import { handleRoute, ok, withAuth } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET() {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
      const ws = ctx.workspaceId;

      const [
        totalContacts,
        activeContacts,
        unsubscribed,
        messagesByStatus,
        messagesByChannel,
        dealsByStage,
        wonValue,
        sequenceStats,
        campaignCount,
        activeSequences,
      ] = await Promise.all([
        db.contact.count({ where: { workspaceId: ws } }),
        db.contact.count({ where: { workspaceId: ws, status: "subscribed" } }),
        db.contact.count({ where: { workspaceId: ws, status: "unsubscribed" } }),
        db.message.groupBy({ by: ["status"], where: { workspaceId: ws }, _count: { _all: true } }),
        db.message.groupBy({ by: ["channel"], where: { workspaceId: ws }, _count: { _all: true } }),
        db.deal.groupBy({ by: ["stage"], where: { workspaceId: ws }, _count: { _all: true }, _sum: { value: true } }),
        db.deal.aggregate({ where: { workspaceId: ws, stage: "won" }, _sum: { value: true }, _count: { _all: true } }),
        db.enrollment.groupBy({ by: ["status"], where: { workspaceId: ws }, _count: { _all: true } }),
        db.campaign.count({ where: { workspaceId: ws } }),
        db.sequence.count({ where: { workspaceId: ws, status: "active" } }),
      ]);

      const msg: Record<string, number> = {};
      for (const m of messagesByStatus) msg[m.status] = m._count._all;
      const ch: Record<string, number> = {};
      for (const c of messagesByChannel) ch[c.channel] = c._count._all;

      const sent = (msg.sent ?? 0) + (msg.delivered ?? 0) + (msg.opened ?? 0) + (msg.clicked ?? 0) + (msg.replied ?? 0);
      const opened = (msg.opened ?? 0) + (msg.clicked ?? 0) + (msg.replied ?? 0);
      const clicked = (msg.clicked ?? 0) + (msg.replied ?? 0);

      const pipelineByStage: Record<string, { count: number; value: number }> = {};
      for (const d of dealsByStage) {
        pipelineByStage[d.stage] = { count: d._count._all, value: d._sum.value ?? 0 };
      }

      const enroll: Record<string, number> = {};
      for (const s of sequenceStats) enroll[s.status] = s._count._all;

      return ok({
        contacts: { total: totalContacts, active: activeContacts, unsubscribed },
        messages: { byStatus: msg, byChannel: ch, sent, opened, clicked },
        rates: {
          openRate: sent > 0 ? Math.round((opened / sent) * 1000) / 10 : 0,
          clickRate: sent > 0 ? Math.round((clicked / sent) * 1000) / 10 : 0,
          bounceRate: sent > 0 ? Math.round(((msg.bounced ?? 0) / sent) * 1000) / 10 : 0,
        },
        pipeline: {
          byStage: pipelineByStage,
          wonCount: wonValue._count._all,
          wonValue: wonValue._sum.value ?? 0,
        },
        sequences: { byStatus: enroll },
        activity: { campaigns: campaignCount, activeSequences },
      });
    })
  );
}
