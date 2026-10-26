import { db } from "@/lib/db";
import { handleRoute } from "@/lib/api-helpers";
import { recordEvent } from "@/lib/messaging";

export const dynamic = "force-dynamic";

const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

type Params = { params: Promise<{ messageId: string }> };

/** 1x1 tracking pixel: marks the message opened (evidence-observed). */
export async function GET(_req: Request, { params }: Params) {
  return handleRoute(async () => {
    const { messageId } = await params;
    const message = await db.message.findUnique({ where: { id: messageId } });
    if (message && ["sent", "delivered"].includes(message.status)) {
      await db.message.update({
        where: { id: messageId },
        data: { status: "opened", openedAt: new Date() },
      });
      await recordEvent({
        workspaceId: message.workspaceId,
        type: "email.opened",
        contactId: message.contactId,
        campaignId: message.campaignId,
        messageId,
        metadata: { observed: true },
      });
    }
    return new Response(PIXEL, {
      headers: {
        "Content-Type": "image/gif",
        "Cache-Control": "no-store, max-age=0",
      },
    });
  });
}

