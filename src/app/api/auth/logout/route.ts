import { clearSessionCookie } from "@/lib/auth";
import { handleRoute, ok } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function POST() {
  return handleRoute(async () => {
    await clearSessionCookie();
    return ok({ loggedOut: true });
  });
}
