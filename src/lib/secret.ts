/**
 * Central application secret — used for session JWT signing and for
 * encrypting integration credentials (AES-256-GCM via lib/crypto).
 *
 * Resolution order: JWT_SECRET -> NEXTAUTH_SECRET -> dev fallback.
 * In production the fallback is refused: the app fails fast at boot with a
 * clear message instead of silently running with a publicly-known key.
 */
function resolveSecret(): string {
  const secret = process.env.JWT_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "[config] JWT_SECRET is required in production. " +
        "Add JWT_SECRET (or NEXTAUTH_SECRET) in your hosting provider's environment variables — " +
        "on Vercel: Settings → Environment Variables. Generate one with `openssl rand -base64 32`."
    );
  }
  return "dev-secret-change-me-in-production";
}

export const APP_SECRET = resolveSecret();
