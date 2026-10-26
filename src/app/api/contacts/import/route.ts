import { db } from "@/lib/db";
import { handleRoute, ok, withAuth, parseBody, fail } from "@/lib/api-helpers";
import { contactImportSchema } from "@/lib/contracts";
import { recordEvent } from "@/lib/messaging";

export const dynamic = "force-dynamic";

/**
 * CSV import with per-row upsert semantics. Bounded to 2000 rows per call.
 * Returns a per-row evidence report so the caller sees exactly what happened.
 */
export async function POST(req: Request) {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const parsed = await parseBody(req, contactImportSchema);
      if (!parsed.ok) return parsed.response;
      const { contacts, listId } = parsed.data;

      let created = 0, updated = 0, skipped = 0;
      const errors: { row: number; email: string; reason: string }[] = [];

      for (let i = 0; i < contacts.length; i++) {
        const row = contacts[i];
        const email = (row.email ?? row.Email ?? "").trim().toLowerCase();
        if (!email || !email.includes("@")) {
          skipped++;
          errors.push({ row: i + 1, email: email || "(missing)", reason: "invalid email" });
          continue;
        }
        try {
          const fields = {
            firstName: (row.firstName ?? row.first_name ?? "").trim(),
            lastName: (row.lastName ?? row.last_name ?? "").trim(),
            phone: (row.phone ?? "").trim(),
            company: (row.company ?? "").trim(),
            jobTitle: (row.jobTitle ?? row.job_title ?? "").trim(),
            country: (row.country ?? "").trim(),
            city: (row.city ?? "").trim(),
          };
          const existing = await db.contact.findUnique({
            where: { workspaceId_email: { workspaceId: ctx.workspaceId, email } },
          });
          if (existing) {
            await db.contact.update({
              where: { id: existing.id },
              data: {
                ...fields,
                firstName: fields.firstName || existing.firstName,
                lastName: fields.lastName || existing.lastName,
                phone: fields.phone || existing.phone,
                company: fields.company || existing.company,
              },
            });
            if (listId) {
              await db.listMembership.upsert({
                where: { listId_contactId: { listId, contactId: existing.id } },
                create: { listId, contactId: existing.id },
                update: {},
              });
            }
            updated++;
          } else {
            const contact = await db.contact.create({
              data: { workspaceId: ctx.workspaceId, email, source: "import", ...fields },
            });
            if (listId) {
              await db.listMembership.create({ data: { listId, contactId: contact.id } });
            }
            created++;
          }
        } catch (e) {
          skipped++;
          errors.push({ row: i + 1, email, reason: e instanceof Error ? e.message : "unknown" });
        }
      }

      await recordEvent({
        workspaceId: ctx.workspaceId,
        type: "contacts.imported",
        metadata: { created, updated, skipped },
      });

      return ok({ created, updated, skipped, errors: errors.slice(0, 50) });
    })
  );
}
