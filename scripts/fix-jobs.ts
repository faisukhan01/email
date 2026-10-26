import { createClient } from "@libsql/client";
const c = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN! });
const r = await c.execute("UPDATE ea_execution SET status='done', lastError=NULL WHERE status='pending' AND type='send_single'");
console.log("marked done:", r.rows_affected);
