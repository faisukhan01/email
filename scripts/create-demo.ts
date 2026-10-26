import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";
import bcrypt from "bcryptjs";
const adapter = new PrismaLibSQL({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN! });
const db = new PrismaClient({ adapter });
const email = "demo@flowengine.app";
const existing = await db.user.findUnique({ where: { email } });
if (existing) {
  console.log("demo user exists");
} else {
  await db.user.create({ data: { email, passwordHash: await bcrypt.hash("demo12345", 10), name: "Demo User" } });
  console.log("demo user created");
}
process.exit(0);
