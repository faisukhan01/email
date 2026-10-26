import { db } from "@/lib/db";
import { handleRoute, ok, withAuth, parseBody, fail, clampLimit } from "@/lib/api-helpers";
import { contactCreateSchema } from "@/lib/contracts";
import { recordEvent } from "@/lib/messaging";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const url = new URL(req.url);
      const limit = clampLimit(url.searchParams.get("limit"));
      const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
      const search = url.searchParams.get("search")?.trim() ?? "";
      const status = url.searchParams.get("status") ?? "";
      const listId = url.searchParams.get("listId") ?? "";

      const where = {
        workspaceId: ctx.workspaceId,
        ...(status ? { status } : {}),
        ...(search
          ? {
              OR: [
                { email: { contains: search } },
                { firstName: { contains: search } },
                { lastName: { contains: search } },
                { company: { contains: search } },
              ],
            }
          : {}),
        ...(listId ? { lists: { some: { listId } } } : {}),
      };

      const [contacts, total] = await Promise.all([
        db.contact.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take: limit,
          skip: offset,
          select: {
            id: true, email: true, firstName: true, lastName: true, phone: true,
            company: true, jobTitle: true, country: true, city: true, status: true,
            lifecycleStage: true, leadScore: true, tags: true, source: true,
            lastActivityAt: true, createdAt: true,
          },
        }),
        db.contact.count({ where }),
      ]);

      return ok({ contacts: contacts.map((c) => ({ ...c, tags: JSON.parse(c.tags) })), total, limit, offset });
    })
  );
}

export async function POST(req: Request) {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const parsed = await parseBody(req, contactCreateSchema);
      if (!parsed.ok) return parsed.response;
      const data = parsed.data;
      const { listIds, ...fields } = data;

      const existing = await db.contact.findUnique({
        where: { workspaceId_email: { workspaceId: ctx.workspaceId, email: data.email } },
      });
      if (existing) {
        return fail("CONFLICT", `Contact ${data.email} already exists`, {
          remediation: "Edit the existing contact instead, or import with upsert.",
        });
      }

      const contact = await db.contact.create({
        data: {
          ...fields,
          workspaceId: ctx.workspaceId,
          tags: JSON.stringify(fields.tags ?? []),
        },
      });

      if (listIds?.length) {
        const lists = await db.list.findMany({
          where: { id: { in: listIds }, workspaceId: ctx.workspaceId },
          select: { id: true },
        });
        await db.listMembership.createMany({
          data: lists.map((l) => ({ listId: l.id, contactId: contact.id })),
        });
      }

      await recordEvent({
        workspaceId: ctx.workspaceId,
        type: "contact.created",
        contactId: contact.id,
        metadata: { email: contact.email, source: contact.source },
      });
      return ok({ contact }, { status: 201 });
    })
  );
}
