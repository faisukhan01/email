import { db } from "@/lib/db";
import { handleRoute, ok, withAuth, parseBody } from "@/lib/api-helpers";
import { segmentUpsertSchema } from "@/lib/contracts";
import { matchesAllRules, SegmentRule } from "@/lib/messaging";

export const dynamic = "force-dynamic";

export async function GET() {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const segments = await db.segment.findMany({
        where: { workspaceId: ctx.workspaceId },
        orderBy: { createdAt: "desc" },
      });
      return ok({
        segments: segments.map((s) => ({ ...s, rules: JSON.parse(s.rules) })),
      });
    })
  );
}

export async function POST(req: Request) {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const parsed = await parseBody(req, segmentUpsertSchema);
      if (!parsed.ok) return parsed.response;
      const segment = await db.segment.create({
        data: { ...parsed.data, workspaceId: ctx.workspaceId, rules: JSON.stringify(parsed.data.rules) },
      });
      return ok({ segment }, { status: 201 });
    })
  );
}

export async function PUT(req: Request) {
  // Live preview of matching contacts for the rule builder
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const parsed = await parseBody(req, segmentUpsertSchema);
      if (!parsed.ok) return parsed.response;
      const contacts = await db.contact.findMany({
        where: { workspaceId: ctx.workspaceId },
        select: {
          id: true, email: true, firstName: true, lastName: true, company: true,
          country: true, city: true, jobTitle: true, status: true, lifecycleStage: true,
          leadScore: true, phone: true, tags: true,
        },
      });
      const rules = parsed.data.rules as SegmentRule[];
      const matched = contacts.filter((c) => matchesAllRules(c, rules));
      return ok({ total: contacts.length, matchedCount: matched.length, sample: matched.slice(0, 10).map((c) => ({ id: c.id, email: c.email })) });
    })
  );
}
