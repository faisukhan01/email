import { db } from "@/lib/db";
import { handleRoute, fail } from "@/lib/api-helpers";
import { decryptSecret } from "@/lib/crypto";
import { ENGINE_SECRET } from "@/lib/engine";

export const dynamic = "force-dynamic";

/**
 * Internal endpoint for the automation engine mini-service.
 * Guarded by the shared ENGINE_SECRET header (fail-closed).
 * Returns decrypted integration secrets for one workspace.
 */
export async function GET(req: Request) {
  return handleRoute(async () => {
    if (req.headers.get("x-engine-secret") !== ENGINE_SECRET) {
      return fail("UNAUTHORIZED", "Invalid engine secret");
    }
    const url = new URL(req.url);
    const workspaceId = url.searchParams.get("workspaceId");
    if (!workspaceId) return fail("INVALID_INPUT", "Missing workspaceId");

    const integration = await db.integration.findUnique({ where: { workspaceId } });
    if (!integration) return fail("NOT_FOUND", "No integration settings");

    return Response.json({
      ok: true,
      data: {
        emailProvider: integration.emailProvider,
        smtp: {
          host: integration.smtpHost,
          port: integration.smtpPort,
          secure: integration.smtpSecure,
          user: integration.smtpUser,
          pass: decryptSecret(integration.smtpPassEnc),
          fromName: integration.fromName,
          fromEmail: integration.fromEmail,
          replyTo: integration.replyTo,
        },
        resendApiKey: decryptSecret(integration.resendApiKeyEnc),
        whatsapp: {
          phoneNumberId: integration.waPhoneNumberId,
          accessToken: decryptSecret(integration.waAccessTokenEnc),
        },
      },
    });
  });
}
