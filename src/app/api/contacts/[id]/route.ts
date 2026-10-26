import { db } from "@/lib/db";
import { handleRoute, ok, withAuth, parseBody, fail, notFound } from "@/lib/api-helpers";
import { contactUpdateSchema } from "@/lib/contracts";
import { recordEvent } from "@/lib/messaging";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const { id } = await params;
      const contact = await db.contact.findFirst({
        where: { id, workspaceId: ctx.workspaceId },
        include: {
          lists: { include: { list: { select: { id: true, name: true } } } },
          deals: { orderBy: { updatedAt: "desc" } },
          enrollments: {
            include: { sequence: { select: { id: true, name: true, status: true } } },
            orderBy: { enteredAt: "desc" },
            take: 10,
          },
        },
      });
      if (!contact) return notFound("Contact");

      const [messages, activities, events] = await Promise.all([
        db.message.findMany({
          where: { contactId: id, workspaceId: ctx.workspaceId },
          orderBy: { createdAt: "desc" },
          take: 15,
          select: {
            id: true, channel: true, subject: true, status: true, provider: true,
            sentAt: true, openedAt: true, clickedAt: true, error: true, campaignId: true,
          },
        }),
        db.activity.findMany({
          where: { contactId: id, workspaceId: ctx.workspaceId },
          orderBy: { createdAt: "desc" },
          take: 20,
        }),
        db.event.findMany({
          where: { contactId: id, workspaceId: ctx.workspaceId },
          orderBy: { createdAt: "desc" },
          take: 25,
        }),
      ]);

      return ok({
        contact: { ...contact, tags: JSON.parse(contact.tags) },
        lists: contact.lists.map((m) => m.list),
        messages,
        activities,
        events: events.map((e) => ({ ...e, metadata: JSON.parse(e.metadata) })),
      });
    })
  );
}

export async function PATCH(req: Request, { params }: Params) {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const { id } = await params;
      const parsed = await parseBody(req, contactUpdateSchema);
      if (!parsed.ok) return parsed.response;
      const existing = await db.contact.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
      if (!existing) return notFound("Contact");

      const { customFields, status, ...fields } = parsed.data;
      const data: Record<string, unknown> = { ...fields };
      if (fields.tags) data.tags = JSON.stringify(fields.tags);
      if (customFields) {
        const merged = { ...JSON.parse(existing.customFields), ...customFields };
        data.customFields = JSON.stringify(merged);
      }
      if (status && status !== existing.status) {
        data.unsubscribedAt = status === "unsubscribed" ? new Date() : null;
      }

      const contact = await db.contact.update({ where: { id }, data });
      await recordEvent({
        workspaceId: ctx.workspaceId,
        type: "contact.updated",
        contactId: id,
        metadata: { fields: Object.keys(data) },
      });
      return ok({ contact: { ...contact, tags: JSON.parse(contact.tags) } });
    })
  );
}

export async function DELETE(_req: Request, { params }: Params) {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const { id } = await params;
      const existing = await db.contact.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
      if (!existing) return notFound("Contact");
      await db.contact.delete({ where: { id } });
      return ok({ deleted: id });
    })
  );
}
