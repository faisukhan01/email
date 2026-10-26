"use client";

/**
 * Typed API client with envelope-aware error handling.
 * Every response is { ok:true, data } | { ok:false, error:{code,message,retryable,remediation} }
 */
export class ApiError extends Error {
  code: string;
  retryable: boolean;
  remediation: string;
  details?: unknown;
  constructor(err: { code: string; message: string; retryable: boolean; remediation: string; details?: unknown }) {
    super(err.message);
    this.code = err.code;
    this.retryable = err.retryable;
    this.remediation = err.remediation;
    this.details = err.details;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
    credentials: "same-origin",
  });
  let body: { ok?: boolean; data?: T; error?: { code: string; message: string; retryable: boolean; remediation: string; details?: unknown } };
  try {
    body = await res.json();
  } catch {
    throw new ApiError({
      code: "INTERNAL",
      message: `Unexpected server response (${res.status})`,
      retryable: true,
      remediation: "Try again in a moment.",
    });
  }
  if (!res.ok || body.ok === false) {
    throw new ApiError(
      body.error ?? {
        code: "INTERNAL",
        message: `Request failed (${res.status})`,
        retryable: res.status >= 500,
        remediation: "Try again in a moment.",
      }
    );
  }
  return body.data as T;
}

export const api = {
  get: <T,>(path: string) => request<T>(path),
  post: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined }),
  put: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body !== undefined ? JSON.stringify(body) : undefined }),
  patch: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body !== undefined ? JSON.stringify(body) : undefined }),
  del: <T,>(path: string) => request<T>(path, { method: "DELETE" }),
};
