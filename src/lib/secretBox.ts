// Secrets Sidetrack must use again later, such as a calendar's app-specific
// password, kept encrypted at rest: AES-256-GCM with CALENDAR_SECRET_KEY, a
// fresh IV for each value, and the row's id as associated data, so a sealed
// value only opens on the row it was sealed for. A database copy or backup
// without the key reveals nothing. Framework-agnostic: no DB access.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

/** A 32-byte key from base64 (`openssl rand -base64 32`), or null when it isn't one. */
export function parseSecretKey(value: string): Buffer | null {
  if (!/^[A-Za-z0-9+/_-]+=*$/.test(value)) return null;
  // Node's base64 decoder reads the URL-safe alphabet too.
  const key = Buffer.from(value, "base64");
  return key.length === 32 ? key : null;
}

/** `plain` sealed with `key` for the row `context`, as "v1.<iv>.<ciphertext>.<tag>". */
export function sealSecret(plain: string, key: Buffer, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context));
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv, body, cipher.getAuthTag()]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

/** What sealSecret sealed. Throws for another key or row, or a value that was changed. */
export function openSecret(sealed: string, key: Buffer, context: string): string {
  const [version, iv, body, tag] = sealed.split(".");
  if (version !== VERSION || !iv || body === undefined || !tag) throw new Error("not a sealed secret");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}
