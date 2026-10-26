import { db } from "@/lib/db";
import { handleRoute, ok, withAuth, parseBody } from "@/lib/api-helpers";
import { sequenceUpsertSchema } from "@/lib/contracts";

export const dynamic = "force-dynamic";

export async function GET() {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const sequences = await db.sequence.findMany({
        where: { workspaceId: ctx.workspaceId },
        orderBy: { updatedAt: "desc" },
        include: {
          steps: { orderBy: { position: "asc" } },
          _count: { select: { enrollments: true } },
        },
      });
      const activeCounts = await db.enrollment.groupBy({
        by: ["sequenceId"],
        where: { workspaceId: ctx.workspaceId, status: "active" },
        _count: { _all: true },
      });
      const activeMap = new Map(activeCounts.map((a) => [a.sequenceId, a._count._all]));
      return ok({
        sequences: sequences.map((s) => ({
          ...s,
          steps: s.steps.map((st) => ({ ...st, config: JSON.parse(st.config) })),
          activeEnrollments: activeMap.get(s.id) ?? 0,
        })),
      });
    })
  );
}

export async function POST(req: Request) {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const parsed = await parseBody(req, sequenceUpsertSchema);
      if (!parsed.ok) return parsed.response;
      const sequence = await db.sequence.create({
        data: {
          ...parsed.data,
          workspaceId: ctx.workspaceId,
          triggerConfig: JSON.stringify(parsed.data.triggerConfig ?? {}),
        },
      });
      return ok({ sequence }, { status: 201 });
    })
  );
}
