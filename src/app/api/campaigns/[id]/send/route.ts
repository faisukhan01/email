import { db } from "@/lib/db";
import { handleRoute, ok, withAuth, parseBody, fail, notFound } from "@/lib/api-helpers";
import { campaignSendSchema } from "@/lib/contracts";
import { recordEvent } from "@/lib/messaging";
import { after } from "next/server";
import { runEngineTick } from "@/lib/runner";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Enqueues a campaign for dispatch by the automation engine (lease-based queue). */
export async function POST(req: Request, { params }: Params) {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const { id } = await params;
      const parsed = await parseBody(req, campaignSendSchema);
      if (!parsed.ok) return parsed.response;
      const { mode, scheduledAt } = parsed.data;

      const campaign = await db.campaign.findFirst({
        where: { id, workspaceId: ctx.workspaceId },
      });
      if (!campaign) return notFound("Campaign");
      if (["sending", "scheduled"].includes(campaign.status)) {
        return fail("CONFLICT", `Campaign is already ${campaign.status}`, {
          remediation: "Wait for the current run to finish, or pause it first.",
        });
      }
      if (!campaign.bodyHtml && campaign.channel === "email") {
        return fail("INVALID_INPUT", "Campaign has no email body");
      }

      const scheduledFor =
        mode === "schedule" && scheduledAt ? new Date(scheduledAt) : new Date();

      await db.$transaction([
        db.campaign.update({
          where: { id },
          data: {
            status: mode === "schedule" ? "scheduled" : "sending",
            scheduledAt: scheduledFor,
          },
        }),
        db.execution.create({
          data: {
            workspaceId: ctx.workspaceId,
            type: "campaign_dispatch",
            payload: JSON.stringify({ campaignId: id }),
            runAt: scheduledFor,
            priority: 3,
          },
        }),
      ]);

      await recordEvent({
        workspaceId: ctx.workspaceId,
        type: "campaign.scheduled",
        campaignId: id,
        metadata: { mode, scheduledFor: scheduledFor.toISOString() },
      });

      // Opportunistic in-process execution after the response is sent —
      // gives instant dispatch on serverless hosts without waiting for cron.
      if (mode !== "schedule") {
        after(() => runEngineTick({ maxJobs: 10, jobTimeoutMs: 20_000 }).catch(() => {}));
      }

      return ok({
        campaignId: id,
        status: mode === "schedule" ? "scheduled" : "sending",
        scheduledFor: scheduledFor.toISOString(),
      });
    })
  );
}
