import { NextResponse } from "next/server";
import { ZodSchema } from "zod";
import { requireSession, AuthedContext } from "./auth";

/**
 * REA-inspired error algebra: every API response is a tagged envelope with
 * category, retryability and remediation guidance. Fail-closed by default.
 */
export type ErrorCode =
  | "INVALID_INPUT"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "UPSTREAM_FAILURE"
  | "TIMEOUT"
  | "INTERNAL";

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  remediation: string;
  details?: unknown;
}

const HTTP_BY_CODE: Record<ErrorCode, number> = {
  INVALID_INPUT: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  UPSTREAM_FAILURE: 502,
  TIMEOUT: 504,
  INTERNAL: 500,
};

const DEFAULT_REMEDIATION: Record<ErrorCode, string> = {
  INVALID_INPUT: "Check the request payload against the documented schema.",
  UNAUTHORIZED: "Sign in again to refresh your session.",
  NOT_FOUND: "Verify the resource id exists in this workspace.",
  FORBIDDEN: "You do not have access to this resource.",
  CONFLICT: "The resource was modified concurrently; reload and retry.",
  RATE_LIMITED: "Slow down and retry with exponential backoff.",
  UPSTREAM_FAILURE: "The upstream provider failed; retry after a short delay.",
  TIMEOUT: "The operation took too long; retry with a smaller scope.",
  INTERNAL: "An unexpected error occurred; contact support if it persists.",
};

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

export function fail(
  code: ErrorCode,
  message: string,
  opts?: { retryable?: boolean; remediation?: string; details?: unknown }
) {
  const body: ApiErrorBody = {
    code,
    message,
    retryable: opts?.retryable ?? (code === "UPSTREAM_FAILURE" || code === "TIMEOUT"),
    remediation: opts?.remediation ?? DEFAULT_REMEDIATION[code],
    ...(opts?.details ? { details: opts.details } : {}),
  };
  return NextResponse.json({ ok: false as const, error: body }, { status: HTTP_BY_CODE[code] });
}

export function notFound(resource = "Resource") {
  return fail("NOT_FOUND", `${resource} not found`);
}

/**
 * Bounded output guard (REA): cap serialized payload sizes.
 */
export const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MB
export const MAX_LIST_LIMIT = 200;

/** Parses + validates a JSON body with a zod contract. */
export async function parseBody<T>(req: Request, schema: ZodSchema<T>): Promise<
  { ok: true; data: T } | { ok: false; response: ReturnType<typeof fail> }
> {
  const contentLength = req.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
    return {
      ok: false,
      response: fail("INVALID_INPUT", "Payload exceeds 2MB limit", {
        remediation: "Reduce the payload size or paginate the batch.",
      }),
    };
  }
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, response: fail("INVALID_INPUT", "Body must be valid JSON") };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: fail("INVALID_INPUT", "Validation failed", {
        details: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      }),
    };
  }
  return { ok: true, data: parsed.data };
}

/** Wraps a handler with session auth; returns the handler result or 401. */
export async function withAuth(
  fn: (ctx: AuthedContext) => Promise<Response>
): Promise<Response> {
  const ctx = await requireSession();
  if (!ctx) {
    return fail("UNAUTHORIZED", "Authentication required");
  }
  return fn(ctx);
}

/** Uniform catch-all for route handlers. */
export function handleRoute(fn: () => Promise<Response>): Promise<Response> {
  return fn().catch((e: unknown) => {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("[api]", message);
    if (message.includes("Unique constraint")) {
      return fail("CONFLICT", "A record with these unique values already exists");
    }
    if (message.includes("TURSO") || message.toLowerCase().includes("connect")) {
      return fail("UPSTREAM_FAILURE", "Database temporarily unreachable", { retryable: true });
    }
    return fail("INTERNAL", message);
  });
}

export function clampLimit(raw: string | null, fallback = 50): number {
  const n = Number(raw ?? fallback);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), MAX_LIST_LIMIT);
}
