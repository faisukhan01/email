import crypto from "crypto";

/**
 * AES-256-GCM encryption for integration secrets (SMTP passwords, API tokens).
 * REA pattern: fail-closed — encrypted values carry their own integrity proof.
 */
const KEY = crypto
  .createHash("sha256")
  .update(process.env.JWT_SECRET ?? "dev-secret-change-me-in-production")
  .digest();

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `v1.${iv.toString("base64")}.${authTag.toString("base64")}.${encrypted.toString("base64")}`;
}

export function decryptSecret(packed: string | null | undefined): string | null {
  if (!packed) return null;
  const parts = packed.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  try {
    const iv = Buffer.from(parts[1], "base64");
    const authTag = Buffer.from(parts[2], "base64");
    const encrypted = Buffer.from(parts[3], "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Masks a secret for display: keeps prefix/suffix, hides the middle. */
export function maskSecret(value: string): string {
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 4)}••••••••${value.slice(-4)}`;
}
