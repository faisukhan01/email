import { db } from "@/lib/db";
import { verifyPassword, setSessionCookie, ensureWorkspace } from "@/lib/auth";
import { handleRoute, ok, fail, parseBody } from "@/lib/api-helpers";
import { loginSchema } from "@/lib/contracts";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handleRoute(async () => {
    const parsed = await parseBody(req, loginSchema);
    if (!parsed.ok) return parsed.response;
    const { email, password } = parsed.data;

    const user = await db.user.findUnique({ where: { email } });
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return fail("UNAUTHORIZED", "Invalid email or password", {
        remediation: "Check your credentials and try again.",
      });
    }

    const workspaceId = await ensureWorkspace(user.id, user.email);
    await setSessionCookie({ userId: user.id, email: user.email, workspaceId });
    return ok({ user: { id: user.id, name: user.name, email: user.email }, workspaceId });
  });
}
