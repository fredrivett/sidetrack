import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openSecret, parseSecretKey, sealSecret } from "./secretBox";

describe("secretBox", () => {
  const key = randomBytes(32);

  it("opens what it sealed, only with the same key and row", () => {
    const sealed = sealSecret("abcd-efgh", key, "row1");
    expect(sealed).not.toContain("abcd");
    expect(sealSecret("abcd-efgh", key, "row1")).not.toBe(sealed);
    expect(openSecret(sealed, key, "row1")).toBe("abcd-efgh");
    expect(() => openSecret(sealed, key, "row2")).toThrow();
    expect(() => openSecret(sealed, randomBytes(32), "row1")).toThrow();
    const [v, iv, body, tag] = sealed.split(".");
    const flipped = Buffer.from(body, "base64url");
    flipped[0] ^= 1;
    expect(() => openSecret([v, iv, flipped.toString("base64url"), tag].join("."), key, "row1")).toThrow();
    // A tag cut short would be easier to forge.
    const short = Buffer.from(tag, "base64url").subarray(0, 4).toString("base64url");
    expect(() => openSecret([v, iv, body, short].join("."), key, "row1")).toThrow();
  });

  it("takes only a 32-byte key", () => {
    expect(parseSecretKey(key.toString("base64"))).toEqual(key);
    expect(parseSecretKey(key.toString("base64url"))).toEqual(key);
    expect(parseSecretKey(randomBytes(16).toString("base64"))).toBeNull();
    expect(parseSecretKey("not base64!")).toBeNull();
  });
});
