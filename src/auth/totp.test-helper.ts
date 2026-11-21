import { createHmac } from "node:crypto";

// What an authenticator app shows for an otpauth:// URI right now: RFC 6238
// TOTP (SHA-1, 6 digits, 30s) from the base32 secret, worked out here rather
// than with Better Auth's own code, so tests prove a real app's codes work.
export function totpCode(totpURI: string, at = Date.now()): string {
  const secret = new URL(totpURI).searchParams.get("secret") ?? "";
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secret.replace(/=+$/, "").toUpperCase()) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  }
  const key = Buffer.from(bits.match(/.{8}/g)?.map((b) => parseInt(b, 2)) ?? []);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const hmac = createHmac("sha1", key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const value = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return value.toString().padStart(6, "0");
}
