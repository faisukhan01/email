import { db } from "@/lib/db";
import { handleRoute, ok, fail, parseBody } from "@/lib/api-helpers";
import { publicSubscribeSchema } from "@/lib/contracts";
import { recordEvent } from "@/lib/messaging";

export const dynamic = "force-dynamic";

/** Public subscription endpoint for embedding forms on any website. */
export async function POST(req: Request) {
  return handleRoute(async () => {
    const parsed = await parseBody(req, publicSubscribeSchema);
    if (!parsed.ok) return parsed.response;
    const { workspaceId, email, firstName, lastName, listId } = parsed.data;

    const workspace = await db.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) return fail("NOT_FOUND", "Unknown workspace");

    const contact = await db.contact.upsert({
      where: { workspaceId_email: { workspaceId, email } },
      create: {
        workspaceId, email, firstName, lastName,
        source: "form",
        status: "subscribed",
      },
      update: { status: "subscribed", unsubscribedAt: null, firstName, lastName },
    });

    if (listId) {
      const list = await db.list.findFirst({ where: { id: listId, workspaceId } });
      if (list) {
        await db.listMembership.upsert({
          where: { listId_contactId: { listId, contactId: contact.id } },
          create: { listId, contactId: contact.id },
          update: {},
        });
      }
    }

    await recordEvent({
      workspaceId,
      type: "contact.created",
      contactId: contact.id,
      metadata: { source: "public_form" },
    });

    return ok({ subscribed: true });
  });
}
