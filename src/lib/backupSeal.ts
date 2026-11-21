// A database backup sealed for storage off the server: gzipped, then
// encrypted with AES-256-GCM under BACKUP_ENCRYPTION_KEY, so a leaked bucket
// key reveals nothing (the database holds emails, password hashes and session
// tokens). The tag also proves a backup wasn't changed or cut short.
// Framework-agnostic: no DB access.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

/** Starts every sealed backup, and is authenticated with it. */
const HEADER = Buffer.from("sidetrack-backup-v1\n");
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** `db` gzipped and encrypted with `key` (32 bytes): header, IV, tag, ciphertext. */
export function sealBackup(db: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(HEADER);
  const body = Buffer.concat([cipher.update(gzipSync(db)), cipher.final()]);
  return Buffer.concat([HEADER, iv, cipher.getAuthTag(), body]);
}

/** The database sealBackup sealed. Throws for another key, or a file that was changed. */
export function openBackup(sealed: Buffer, key: Buffer): Buffer {
  if (!sealed.subarray(0, HEADER.length).equals(HEADER)) throw new Error("not a sealed Sidetrack backup");
  let at = HEADER.length;
  const iv = sealed.subarray(at, (at += IV_BYTES));
  const tag = sealed.subarray(at, (at += TAG_BYTES));
  const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(HEADER);
  decipher.setAuthTag(tag);
  return gunzipSync(Buffer.concat([decipher.update(sealed.subarray(at)), decipher.final()]));
}
