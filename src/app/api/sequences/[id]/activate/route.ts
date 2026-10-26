import { db } from "@/lib/db";
import { handleRoute, ok, withAuth, notFound } from "@/lib/api-helpers";
import { recordEvent } from "@/lib/messaging";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Activates or pauses a sequence. Activation also enrolls existing matching contacts if requested. */
export async function POST(req: Request, { params }: Params) {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const { id } = await params;
      const sequence = await db.sequence.findFirst({
        where: { id, workspaceId: ctx.workspaceId },
        include: { steps: { orderBy: { position: "asc" } } },
      });
      if (!sequence) return notFound("Sequence");

      const body = (await req.json().catch(() => ({}))) as { action?: string };
      const action = body.action === "pause" ? "pause" : "activate";

      if (action === "activate" && sequence.steps.length === 0) {
        return ok({ error: "Sequence has no steps. Add at least one step before activating." }, { status: 400 });
      }

      const status = action === "pause" ? "paused" : "active";
      await db.sequence.update({ where: { id }, data: { status } });

      // Enroll existing contacts matching the trigger on activation
      let enrolled = 0;
      if (action === "activate" && sequence.enrollExisting) {
        const trigger = JSON.parse(sequence.triggerConfig || "{}");
        let candidates: { id: string }[] = [];
        if (sequence.triggerType === "added_to_list" && trigger.listId) {
          candidates = await db.listMembership.findMany({
            where: { listId: trigger.listId },
            select: { contactId: true },
          }).then((rows) => rows.map((r) => ({ id: r.contactId })));
        } else if (sequence.triggerType === "contact_created") {
          candidates = await db.contact.findMany({
            where: { workspaceId: ctx.workspaceId, status: "subscribed" },
            select: { id: true },
            take: 500,
          });
        }
        for (const c of candidates.slice(0, 200)) {
          try {
            await db.enrollment.create({
              data: { workspaceId: ctx.workspaceId, sequenceId: id, contactId: c.id },
            });
            await db.execution.create({
              data: {
                workspaceId: ctx.workspaceId,
                type: "sequence_step",
                stepId: sequence.steps[0]?.id ?? null,
                priority: 5,
                payload: JSON.stringify({ sequenceId: id, contactId: c.id, stepPosition: 1 }),
              },
            });
            enrolled++;
          } catch {
            // already enrolled — unique constraint
          }
        }
      }

      await recordEvent({
        workspaceId: ctx.workspaceId,
        type: "sequence.status_changed",
        metadata: { sequenceId: id, status, enrolledExisting: enrolled },
      });
      return ok({ status, enrolledExisting: enrolled });
    })
  );
}
