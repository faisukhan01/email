import { db } from "@/lib/db";
import { hashPassword, setSessionCookie, ensureWorkspace } from "@/lib/auth";
import { handleRoute, ok, fail, parseBody } from "@/lib/api-helpers";
import { registerSchema } from "@/lib/contracts";
import { recordEvent } from "@/lib/messaging";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handleRoute(async () => {
    const parsed = await parseBody(req, registerSchema);
    if (!parsed.ok) return parsed.response;
    const { name, email, password } = parsed.data;

    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      return fail("CONFLICT", "An account with this email already exists", {
        remediation: "Sign in instead, or use a different email address.",
      });
    }

    const user = await db.user.create({
      data: { name, email, passwordHash: await hashPassword(password) },
    });
    const workspaceId = await ensureWorkspace(user.id, email);
    await setSessionCookie({ userId: user.id, email, workspaceId });
    await recordEvent({
      workspaceId,
      type: "workspace.created",
      metadata: { email },
    });
    return ok({ user: { id: user.id, name, email }, workspaceId });
  });
}
