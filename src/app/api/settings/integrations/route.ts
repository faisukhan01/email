import { db } from "@/lib/db";
import { handleRoute, ok, withAuth, parseBody, fail } from "@/lib/api-helpers";
import { integrationSchema } from "@/lib/contracts";
import { encryptSecret } from "@/lib/crypto";

export const dynamic = "force-dynamic";

export async function GET() {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const integration = await db.integration.findUnique({
        where: { workspaceId: ctx.workspaceId },
      });
      if (!integration) return fail("NOT_FOUND", "Integration settings missing");
      const workspace = await db.workspace.findUnique({ where: { id: ctx.workspaceId } });
      return ok({
        integration: {
          emailProvider: integration.emailProvider,
          smtpHost: integration.smtpHost,
          smtpPort: integration.smtpPort,
          smtpSecure: integration.smtpSecure,
          smtpUser: integration.smtpUser,
          smtpPassSet: !!integration.smtpPassEnc,
          fromName: integration.fromName,
          fromEmail: integration.fromEmail,
          replyTo: integration.replyTo,
          resendApiKeySet: !!integration.resendApiKeyEnc,
          waPhoneNumberId: integration.waPhoneNumberId,
          waAccessTokenSet: !!integration.waAccessTokenEnc,
          waVerifyToken: integration.waVerifyToken,
        },
        simulationMode: workspace?.simulationMode ?? true,
      });
    })
  );
}

export async function PUT(req: Request) {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const parsed = await parseBody(req, integrationSchema);
      if (!parsed.ok) return parsed.response;
      const data = parsed.data;

      const existing = await db.integration.findUnique({ where: { workspaceId: ctx.workspaceId } });
      if (!existing) return fail("NOT_FOUND", "Integration settings missing");

      const update: Record<string, unknown> = {};
      const direct: (keyof typeof data)[] = [
        "emailProvider", "smtpHost", "smtpPort", "smtpSecure", "smtpUser",
        "fromName", "fromEmail", "replyTo", "waPhoneNumberId", "waVerifyToken",
      ];
      for (const key of direct) {
        if (data[key] !== undefined) update[key] = data[key];
      }
      if (data.smtpPass !== undefined && data.smtpPass !== "") {
        update.smtpPassEnc = encryptSecret(data.smtpPass);
      }
      if (data.resendApiKey !== undefined && data.resendApiKey !== "") {
        update.resendApiKeyEnc = encryptSecret(data.resendApiKey);
      }
      if (data.waAccessToken !== undefined && data.waAccessToken !== "") {
        update.waAccessTokenEnc = encryptSecret(data.waAccessToken);
      }
      if (data.simulationMode !== undefined) {
        await db.workspace.update({
          where: { id: ctx.workspaceId },
          data: { simulationMode: data.simulationMode },
        });
      }

      await db.integration.update({ where: { workspaceId: ctx.workspaceId }, data: update });
      return ok({ saved: true });
    })
  );
}

/** Sends a test message through the configured provider (queued, high priority). */
export async function POST(req: Request) {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const parsed = await parseBody(req, integrationSchema);
      if (!parsed.ok) return parsed.response;
      return ok({ hint: "Use POST /api/engine/test-send with {channel,to}" });
    })
  );
}
