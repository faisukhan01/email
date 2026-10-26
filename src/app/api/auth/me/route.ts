import { db } from "@/lib/db";
import { handleRoute, ok, withAuth } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET() {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const [user, workspace, integration] = await Promise.all([
        db.user.findUnique({ where: { id: ctx.userId }, select: { id: true, name: true, email: true, avatarColor: true } }),
        db.workspace.findUnique({ where: { id: ctx.workspaceId } }),
        db.integration.findUnique({ where: { workspaceId: ctx.workspaceId } }),
      ]);
      if (!user || !workspace) {
        return ok({ user: null, workspace: null, connected: false });
      }
      return ok({
        user,
        workspace: {
          id: workspace.id,
          name: workspace.name,
          simulationMode: workspace.simulationMode,
          timezone: workspace.timezone,
          currency: workspace.currency,
        },
        connected: true,
        channelMode: integration?.emailProvider ?? "simulator",
      });
    })
  );
}
