import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openBackup, sealBackup } from "./backupSeal";

describe("backupSeal", () => {
  const key = randomBytes(32);
  // Compressible, with a marker that must not show through the encryption.
  const db = Buffer.concat([Buffer.from("SQLite format 3\0 secret@example.com "), Buffer.alloc(50_000, 7)]);

  it("opens what it sealed, compressed and unreadable without the key", () => {
    const sealed = sealBackup(db, key);
    expect(sealed.length).toBeLessThan(db.length / 10);
    expect(sealed.includes("secret@example.com")).toBe(false);
    expect(sealBackup(db, key).equals(sealed)).toBe(false);
    expect(openBackup(sealed, key).equals(db)).toBe(true);
    expect(() => openBackup(sealed, randomBytes(32))).toThrow();
  });

  it("refuses a backup that was changed or cut short", () => {
    const sealed = sealBackup(db, key);
    const flipped = Buffer.from(sealed);
    flipped[flipped.length - 1] ^= 1;
    expect(() => openBackup(flipped, key)).toThrow();
    expect(() => openBackup(sealed.subarray(0, sealed.length - 1), key)).toThrow();
    expect(() => openBackup(Buffer.from("SQLite format 3\0"), key)).toThrow(/not a sealed/);
  });
});
