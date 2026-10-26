import { db } from "@/lib/db";
import { handleRoute, ok, fail } from "@/lib/api-helpers";
import { recordEvent } from "@/lib/messaging";

export const dynamic = "force-dynamic";

/**
 * WhatsApp Cloud API webhook: GET for Meta verification, POST for inbound
 * status updates and messages. Events are recorded for evidence; unknown
 * shapes are ignored (observational, never mutating).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && challenge) {
    const integrations = await db.integration.findMany({
      where: { waVerifyToken: { not: null } },
      select: { waVerifyToken: true },
    });
    const valid = integrations.some((i) => i.waVerifyToken === token);
    if (valid) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }
  return ok({ service: "whatsapp-webhook", status: "ready" });
}

export async function POST(req: Request) {
  return handleRoute(async () => {
    const body = (await req.json().catch(() => null)) as any;
    if (!body) return fail("INVALID_INPUT", "Body must be JSON");

    const entries = body?.entry ?? [];
    for (const entry of entries) {
      for (const change of entry?.changes ?? []) {
        const value = change?.value;
        if (!value) continue;

        // Delivery/status events
        for (const status of value?.statuses ?? []) {
          const providerMsgId = status?.id;
          if (!providerMsgId) continue;
          const message = await db.message.findFirst({
            where: { providerMsgId, channel: "whatsapp" },
          });
          if (!message) continue;
          const state = status?.status;
          if (state === "delivered" && ["sent"].includes(message.status)) {
            await db.message.update({ where: { id: message.id }, data: { status: "delivered" } });
            await recordEvent({ workspaceId: message.workspaceId, type: "whatsapp.delivered", contactId: message.contactId, campaignId: message.campaignId, messageId: message.id });
          } else if (state === "read") {
            await db.message.update({
              where: { id: message.id },
              data: { status: message.status === "clicked" ? "clicked" : "opened", openedAt: new Date() },
            });
            await recordEvent({ workspaceId: message.workspaceId, type: "whatsapp.read", contactId: message.contactId, campaignId: message.campaignId, messageId: message.id });
          } else if (state === "failed") {
            await db.message.update({
              where: { id: message.id },
              data: { status: "failed", error: status?.errors?.[0]?.title ?? "delivery failed" },
            });
          }
        }

        // Inbound messages (evidence recorded; routing left to automations)
        for (const msg of value?.messages ?? []) {
          const from = msg?.from;
          if (!from) continue;
          const contact = await db.contact.findFirst({
            where: { phone: { contains: from.slice(-9) }, workspaceId: { not: undefined } },
          });
          if (contact) {
            await recordEvent({
              workspaceId: contact.workspaceId,
              type: "whatsapp.received",
              contactId: contact.id,
              metadata: { from, type: msg?.type, body: String(msg?.text?.body ?? "").slice(0, 500) },
            });
            if (["stop", "unsubscribe"].includes(String(msg?.text?.body ?? "").trim().toLowerCase())) {
              await db.contact.update({
                where: { id: contact.id },
                data: { status: "unsubscribed", unsubscribedAt: new Date() },
              });
            }
          }
        }
      }
    }
    return ok({ received: true });
  });
}
