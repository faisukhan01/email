// Applies generated DDL to Turso (one-time migration bootstrap)
import { createClient } from "@libsql/client";
import { readFileSync } from "fs";

const url = process.env.TURSO_DATABASE_URL;
const token = process.env.TURSO_AUTH_TOKEN;
if (!url || !token) throw new Error("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN");

const client = createClient({ url, authToken: token });

const ddl = readFileSync("/tmp/ddl.sql", "utf-8");
const statements = ddl
  .split(/;\s*\n/)
  .map((s) =>
    s
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .trim()
  )
  .filter((s) => s.length > 0);

console.log(`Applying ${statements.length} statements to ${url}`);
let applied = 0;
for (const stmt of statements) {
  try {
    await client.execute(stmt);
    applied++;
  } catch (e: any) {
    if (String(e.message).includes("already exists")) {
      console.log("skip (exists):", stmt.slice(0, 60));
    } else {
      console.error("FAILED:", stmt.slice(0, 100), e.message);
      process.exit(1);
    }
  }
}
console.log(`Applied ${applied}/${statements.length} statements OK`);

const check = await client.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
console.log("Tables:", check.rows.map((r) => r.name).join(", "));
