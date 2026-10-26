import { db } from "@/lib/db";
import { handleRoute, ok, withAuth, parseBody, notFound } from "@/lib/api-helpers";
import { enrollSchema } from "@/lib/contracts";
import { recordEvent } from "@/lib/messaging";
import { after } from "next/server";
import { runEngineTick } from "@/lib/runner";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Manually enrolls contacts into a sequence and schedules their first step. */
export async function POST(req: Request, { params }: Params) {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const { id } = await params;
      const sequence = await db.sequence.findFirst({
        where: { id, workspaceId: ctx.workspaceId },
        include: { steps: { orderBy: { position: "asc" } } },
      });
      if (!sequence) return notFound("Sequence");
      if (sequence.steps.length === 0) {
        return ok({ enrolled: 0, skipped: 0, reason: "Sequence has no steps" });
      }

      const parsed = await parseBody(req, enrollSchema);
      if (!parsed.ok) return parsed.response;
      const contacts = await db.contact.findMany({
        where: { id: { in: parsed.data.contactIds }, workspaceId: ctx.workspaceId },
        select: { id: true },
      });

      let enrolled = 0, skipped = 0;
      for (const contact of contacts) {
        const existing = await db.enrollment.findUnique({
          where: { sequenceId_contactId: { sequenceId: id, contactId: contact.id } },
        });
        if (existing && existing.status === "active") {
          skipped++;
          continue;
        }
        if (existing) {
          await db.enrollment.update({
            where: { id: existing.id },
            data: { status: "active", currentPosition: 0, completedAt: null, exitReason: null },
          });
        } else {
          await db.enrollment.create({
            data: { workspaceId: ctx.workspaceId, sequenceId: id, contactId: contact.id },
          });
        }
        await db.execution.create({
          data: {
            workspaceId: ctx.workspaceId,
            type: "sequence_step",
            stepId: sequence.steps[0].id,
            priority: 5,
            payload: JSON.stringify({ sequenceId: id, contactId: contact.id, stepPosition: 1 }),
          },
        });
        enrolled++;
      }

      await recordEvent({
        workspaceId: ctx.workspaceId,
        type: "sequence.enrolled",
        metadata: { sequenceId: id, enrolled, skipped },
      });

      // Opportunistic in-process execution after the response is sent.
      if (enrolled > 0) {
        after(() => runEngineTick({ maxJobs: 10, jobTimeoutMs: 20_000 }).catch(() => {}));
      }

      return ok({ enrolled, skipped });
    })
  );
}
