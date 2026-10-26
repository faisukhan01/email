import { db } from "@/lib/db";
import { handleRoute, ok, withAuth, parseBody, fail } from "@/lib/api-helpers";
import crypto from "crypto";

export const dynamic = "force-dynamic";

export async function GET() {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const keys = await db.apiKey.findMany({
        where: { workspaceId: ctx.workspaceId, revokedAt: null },
        orderBy: { createdAt: "desc" },
      });
      return ok({ keys });
    })
  );
}

export async function POST(req: Request) {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const body = (await req.json().catch(() => ({}))) as { name?: string };
      const name = (body.name ?? "Default Key").slice(0, 60);

      const count = await db.apiKey.count({ where: { workspaceId: ctx.workspaceId, revokedAt: null } });
      if (count >= 10) {
        return fail("RATE_LIMITED", "Maximum 10 active API keys per workspace");
      }

      const raw = `eak_${crypto.randomBytes(24).toString("hex")}`;
      const key = await db.apiKey.create({
        data: {
          workspaceId: ctx.workspaceId,
          name,
          prefix: raw.slice(0, 12),
          keyHash: crypto.createHash("sha256").update(raw).digest("hex"),
        },
      });
      // The raw key is returned exactly once (fail-closed secret handling)
      return ok({ key: { id: key.id, name: key.name, prefix: key.prefix, createdAt: key.createdAt }, raw }, { status: 201 });
    })
  );
}

export async function DELETE(req: Request) {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const url = new URL(req.url);
      const id = url.searchParams.get("id");
      if (!id) return fail("INVALID_INPUT", "Missing ?id query parameter");
      const key = await db.apiKey.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
      if (!key) return fail("NOT_FOUND", "API key not found");
      await db.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
      return ok({ revoked: id });
    })
  );
}
