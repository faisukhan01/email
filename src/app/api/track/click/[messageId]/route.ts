import { db } from "@/lib/db";
import { handleRoute } from "@/lib/api-helpers";
import { recordEvent } from "@/lib/messaging";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ messageId: string }> };

/** Tracked link redirect: records the click, then forwards to the destination. */
export async function GET(req: Request, { params }: Params) {
  return handleRoute(async () => {
    const { messageId } = await params;
    const url = new URL(req.url);
    const target = url.searchParams.get("url") ?? "/";

    // Only allow http(s) redirects (fail-closed)
    let safeTarget = "/";
    if (/^https?:\/\//i.test(target)) {
      safeTarget = target;
    }

    const message = await db.message.findUnique({ where: { id: messageId } });
    if (message) {
      const wasFirstClick = !["clicked", "replied"].includes(message.status);
      if (wasFirstClick) {
        await db.message.update({
          where: { id: messageId },
          data: { status: "clicked", clickedAt: new Date(), openedAt: message.openedAt ?? new Date() },
        });
      }
      await recordEvent({
        workspaceId: message.workspaceId,
        type: "email.clicked",
        contactId: message.contactId,
        campaignId: message.campaignId,
        messageId,
        metadata: { target: safeTarget, first: wasFirstClick },
      });
    }

    return NextResponse.redirect(safeTarget, { status: 302 });
  });
}
