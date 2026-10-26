import { db } from "@/lib/db";
import { handleRoute, ok, withAuth, parseBody } from "@/lib/api-helpers";
import { bulkActionSchema } from "@/lib/contracts";
import { recordEvent } from "@/lib/messaging";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const parsed = await parseBody(req, bulkActionSchema);
      if (!parsed.ok) return parsed.response;
      const { action, contactIds, value } = parsed.data;

      const contacts = await db.contact.findMany({
        where: { id: { in: contactIds }, workspaceId: ctx.workspaceId },
        select: { id: true, tags: true },
      });
      const ids = contacts.map((c) => c.id);
      let affected = 0;

      if (action === "delete") {
        const res = await db.contact.deleteMany({ where: { id: { in: ids } } });
        affected = res.count;
      } else if (action === "add_tag" && value) {
        for (const c of contacts) {
          const tags: string[] = JSON.parse(c.tags);
          if (!tags.includes(value)) tags.push(value);
          await db.contact.update({ where: { id: c.id }, data: { tags: JSON.stringify(tags) } });
        }
        affected = ids.length;
      } else if (action === "remove_tag" && value) {
        for (const c of contacts) {
          const tags: string[] = JSON.parse(c.tags).filter((t: string) => t !== value);
          await db.contact.update({ where: { id: c.id }, data: { tags: JSON.stringify(tags) } });
        }
        affected = ids.length;
      } else if (action === "add_to_list" && value) {
        const list = await db.list.findFirst({ where: { id: value, workspaceId: ctx.workspaceId } });
        if (list) {
          for (const contactId of ids) {
            await db.listMembership.upsert({
              where: { listId_contactId: { listId: list.id, contactId } },
              create: { listId: list.id, contactId },
              update: {},
            });
          }
          affected = ids.length;
        }
      } else if (action === "set_status" && value) {
        const res = await db.contact.updateMany({
          where: { id: { in: ids } },
          data: { status: value, ...(value === "unsubscribed" ? { unsubscribedAt: new Date() } : {}) },
        });
        affected = res.count;
      }

      await recordEvent({
        workspaceId: ctx.workspaceId,
        type: "contacts.bulk_action",
        metadata: { action, affected },
      });
      return ok({ affected });
    })
  );
}
