import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";
const adapter = new PrismaLibSQL({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN! });
const db = new PrismaClient({ adapter });
const dupes = await db.$queryRaw<{ id: string }[]>`
  SELECT m.id FROM ea_message m
  JOIN ea_message m2 ON m.campaignId = m2.campaignId AND m.contactId = m2.contactId AND m.id > m2.id
`;
for (const d of dupes) await db.message.delete({ where: { id: d.id } });
console.log("deduped:", dupes.length);
process.exit(0);
