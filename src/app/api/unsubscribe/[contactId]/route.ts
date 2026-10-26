import { db } from "@/lib/db";
import { handleRoute } from "@/lib/api-helpers";
import { recordEvent } from "@/lib/messaging";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ contactId: string }> };

const PAGE = (email: string) => `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Unsubscribed</title></head>
<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f8fafc;margin:0">
  <div style="text-align:center;padding:2rem">
    <div style="font-size:3rem">&#10003;</div>
    <h1 style="color:#0f172a">You're unsubscribed</h1>
    <p style="color:#475569">${email} will no longer receive marketing emails from this sender.</p>
  </div>
</body></html>`;

/** One-click unsubscribe (GET so it works from plain email clients). */
export async function GET(_req: Request, { params }: Params) {
  return handleRoute(async () => {
    const { contactId } = await params;
    const contact = await db.contact.findUnique({ where: { id: contactId } });
    if (contact && contact.status !== "unsubscribed") {
      await db.contact.update({
        where: { id: contactId },
        data: { status: "unsubscribed", unsubscribedAt: new Date() },
      });
      await recordEvent({
        workspaceId: contact.workspaceId,
        type: "contact.unsubscribed",
        contactId,
        metadata: { source: "email_footer" },
      });
    }
    return new NextResponse(PAGE(contact?.email ?? "This address"), {
      headers: { "Content-Type": "text/html" },
    });
  });
}
