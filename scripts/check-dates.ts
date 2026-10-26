import { createClient } from "@libsql/client";
const c = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN! });
const r = await c.execute("SELECT runAt, createdAt FROM ea_execution LIMIT 2");
console.log("execution dates:", JSON.stringify(r.rows));
const r2 = await c.execute("SELECT sentAt, createdAt FROM ea_message LIMIT 1");
console.log("message dates:", JSON.stringify(r2.rows));
