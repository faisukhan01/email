import { createClient } from "@libsql/client";
const c = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN! });
const r = await c.execute("SELECT id, type, status, attempts, substr(lastError,1,80) AS err, runAt FROM ea_execution ORDER BY createdAt DESC LIMIT 6");
r.rows.forEach(row => console.log(JSON.stringify(row)));
