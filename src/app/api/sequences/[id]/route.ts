import { db } from "@/lib/db";
import { handleRoute, ok, withAuth, parseBody, notFound } from "@/lib/api-helpers";
import { sequenceUpsertSchema } from "@/lib/contracts";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const { id } = await params;
      const sequence = await db.sequence.findFirst({
        where: { id, workspaceId: ctx.workspaceId },
        include: {
          steps: { orderBy: { position: "asc" } },
          enrollments: {
            orderBy: { enteredAt: "desc" },
            take: 50,
            include: { contact: { select: { id: true, email: true, firstName: true, lastName: true } } },
          },
        },
      });
      if (!sequence) return notFound("Sequence");

      const executionStats = await db.execution.groupBy({
        by: ["status"],
        where: {
          workspaceId: ctx.workspaceId,
          type: "sequence_step",
          payload: { contains: JSON.stringify(id).slice(1, -1) },
        },
        _count: { _all: true },
      }).catch(() => []);

      return ok({
        sequence: {
          ...sequence,
          triggerConfig: JSON.parse(sequence.triggerConfig),
          steps: sequence.steps.map((s) => ({ ...s, config: JSON.parse(s.config) })),
          enrollments: sequence.enrollments,
        },
        executionStats,
      });
    })
  );
}

export async function PATCH(req: Request, { params }: Params) {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const { id } = await params;
      const existing = await db.sequence.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
      if (!existing) return notFound("Sequence");
      const parsed = await parseBody(req, sequenceUpsertSchema);
      if (!parsed.ok) return parsed.response;
      const sequence = await db.sequence.update({
        where: { id },
        data: { ...parsed.data, triggerConfig: JSON.stringify(parsed.data.triggerConfig ?? {}) },
      });
      return ok({ sequence });
    })
  );
}

export async function DELETE(_req: Request, { params }: Params) {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const { id } = await params;
      const existing = await db.sequence.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
      if (!existing) return notFound("Sequence");
      await db.sequence.delete({ where: { id } });
      return ok({ deleted: id });
    })
  );
}
