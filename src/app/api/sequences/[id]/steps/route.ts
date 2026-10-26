import { db } from "@/lib/db";
import { handleRoute, ok, withAuth, parseBody, notFound, fail } from "@/lib/api-helpers";
import { sequenceStepsReplaceSchema } from "@/lib/contracts";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Replaces the whole step list (order + configs) in one transaction.
 * Steps belonging to running enrollments are not re-executed retroactively.
 */
export async function PUT(req: Request, { params }: Params) {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const { id } = await params;
      const sequence = await db.sequence.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
      if (!sequence) return notFound("Sequence");
      const parsed = await parseBody(req, sequenceStepsReplaceSchema);
      if (!parsed.ok) return parsed.response;

      const { steps } = parsed.data;
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const isSend = step.type === "send_email" || step.type === "send_whatsapp";
        if (isSend && Object.keys(step.config ?? {}).length === 0) {
          return fail("INVALID_INPUT", `Step ${i + 1} (${step.type}) is missing its message config`);
        }
      }

      await db.$transaction(async (tx) => {
        await tx.sequenceStep.deleteMany({ where: { sequenceId: id } });
        if (steps.length > 0) {
          await tx.sequenceStep.createMany({
            data: steps.map((s, i) => ({
              sequenceId: id,
              position: i + 1,
              type: s.type,
              name: s.name || `${s.type.replace(/_/g, " ")} ${i + 1}`,
              config: JSON.stringify({
                ...s.config,
                delayAmount: s.delayAmount,
                delayUnit: s.delayUnit,
              }),
            })),
          });
        }
        await tx.sequence.update({ where: { id }, data: { updatedAt: new Date() } });
      });

      const updated = await db.sequenceStep.findMany({
        where: { sequenceId: id },
        orderBy: { position: "asc" },
      });
      return ok({ steps: updated.map((s) => ({ ...s, config: JSON.parse(s.config) })) });
    })
  );
}
