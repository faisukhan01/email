import { db } from "@/lib/db";
import { handleRoute, ok, withAuth, parseBody, clampLimit } from "@/lib/api-helpers";
import { activityCreateSchema } from "@/lib/contracts";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const url = new URL(req.url);
      const limit = clampLimit(url.searchParams.get("limit"), 30);
      const contactId = url.searchParams.get("contactId");
      const dealId = url.searchParams.get("dealId");
      const activities = await db.activity.findMany({
        where: {
          workspaceId: ctx.workspaceId,
          ...(contactId ? { contactId } : {}),
          ...(dealId ? { dealId } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        include: {
          contact: { select: { email: true, firstName: true, lastName: true } },
        },
      });
      return ok({ activities });
    })
  );
}

export async function POST(req: Request) {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const parsed = await parseBody(req, activityCreateSchema);
      if (!parsed.ok) return parsed.response;
      const activity = await db.activity.create({
        data: { ...parsed.data, workspaceId: ctx.workspaceId },
      });
      if (activity.contactId) {
        await db.contact.update({
          where: { id: activity.contactId },
          data: { lastActivityAt: new Date() },
        });
      }
      return ok({ activity }, { status: 201 });
    })
  );
}
