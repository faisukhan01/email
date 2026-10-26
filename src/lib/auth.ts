import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { db } from "./db";

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? "dev-secret-change-me-in-production"
);
export const SESSION_COOKIE = "ea_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export interface SessionPayload {
  userId: string;
  email: string;
  workspaceId: string;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(SECRET);
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    if (typeof payload.userId !== "string" || typeof payload.workspaceId !== "string") return null;
    return {
      userId: payload.userId,
      email: payload.email as string,
      workspaceId: payload.workspaceId,
    };
  } catch {
    return null;
  }
}

export async function setSessionCookie(payload: SessionPayload): Promise<void> {
  const token = await createSessionToken(payload);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/** Ensures a user owns exactly one workspace; creates one if missing. */
export async function ensureWorkspace(userId: string, email: string): Promise<string> {
  const existing = await db.workspace.findFirst({ where: { ownerId: userId } });
  if (existing) return existing.id;
  const ws = await db.workspace.create({
    data: { name: `${email.split("@")[0]}'s Workspace`, owner: { connect: { id: userId } } },
  });
  await db.integration.create({ data: { workspaceId: ws.id } });
  return ws.id;
}

export interface AuthedContext {
  userId: string;
  email: string;
  workspaceId: string;
}

/** Full auth + workspace resolution for API routes. */
export async function requireSession(): Promise<AuthedContext | null> {
  const session = await getSession();
  if (!session) return null;
  const workspaceId = await ensureWorkspace(session.userId, session.email);
  return { ...session, workspaceId };
}
