import { describe, expect, it, vi } from "vitest";
import { createTestDb, createTestUser } from "./test-helpers";
import {
  getOverdueCollapsed,
  getProfile,
  getTimeZone,
  getUploadedAvatar,
  setAvatarUrl,
  setOverdueCollapsed,
  setTimeZone,
  setUploadedAvatar,
  setUsername,
} from "./users";
import { eq } from "drizzle-orm";
import { listAudit } from "./audit";
import { users } from "./auth-schema";

describe("user timezone", () => {
  it("is unknown until saved, then round-trips", () => {
    const { db } = createTestDb();
    const userId = createTestUser(db);
    expect(getTimeZone(db, userId)).toBeNull();
    setTimeZone(db, userId, "Europe/London");
    expect(getTimeZone(db, userId)).toBe("Europe/London");
  });

  it("rejects unknown zones and fixed offsets, keeping the saved zone", () => {
    const { db } = createTestDb();
    const userId = createTestUser(db);
    setTimeZone(db, userId, "Asia/Tokyo");
    expect(() => setTimeZone(db, userId, "Foo/Bar")).toThrow(/unknown timezone/);
    expect(() => setTimeZone(db, userId, "+05:00")).toThrow(/unknown timezone/);
    expect(getTimeZone(db, userId)).toBe("Asia/Tokyo");
  });
});

describe("Agenda's Overdue fold", () => {
  it("is open by default and saves per user, without an audit row", () => {
    const { db } = createTestDb();
    const me = createTestUser(db);
    const other = createTestUser(db);
    expect(getOverdueCollapsed(db, me)).toBe(false);
    setOverdueCollapsed(db, me, true);
    expect(getOverdueCollapsed(db, me)).toBe(true);
    expect(getOverdueCollapsed(db, other)).toBe(false);
    setOverdueCollapsed(db, me, false);
    expect(getOverdueCollapsed(db, me)).toBe(false);
    expect(listAudit(db, me, {})).toHaveLength(0);
  });
});

describe("avatar", () => {
  // Minimal headers, laid out as the formats define them, padded to 32 bytes.
  const bytes = (...parts: (string | number[])[]) => {
    const flat = parts.flatMap((p) =>
      typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p,
    );
    return Uint8Array.from([...flat, ...Array(Math.max(0, 32 - flat.length)).fill(0)]);
  };
  const be32 = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const le16 = (n: number) => [n & 255, n >>> 8];
  const le24 = (n: number) => [n & 255, (n >>> 8) & 255, n >>> 16];
  const png = (w: number, h: number) =>
    bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a], be32(13), "IHDR", be32(w), be32(h));
  const riff = (chunk: string, body: number[]) =>
    bytes("RIFF", [0, 0, 0, 0], "WEBP", chunk, [0, 0, 0, 0], body);
  // Lossy: frame tag, 9d 01 2a start code, 14-bit sizes.
  const webpLossy = (w: number, h: number) =>
    riff("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(w), ...le16(h)]);
  // Lossless: 0x2f, then width-1 in 14 bits and height-1 in the next 14.
  const webpLossless = (w: number, h: number) => {
    const bits = (w - 1) | ((h - 1) << 14);
    return riff("VP8L", [0x2f, bits & 255, (bits >>> 8) & 255, (bits >>> 16) & 255, bits >>> 24]);
  };
  // Extended: flags, then 24-bit canvas width-1 and height-1.
  const webpExtended = (w: number, h: number) =>
    riff("VP8X", [0, 0, 0, 0, ...le24(w - 1), ...le24(h - 1)]);
  const profileLog = (db: ReturnType<typeof createTestDb>["db"], userId: string) =>
    listAudit(db, userId)
      .filter((e) => e.entityType === "profile")
      .map((e) => [e.action, e.detail, e.entityId, e.source]);

  it("stores an upload by the type its header declares, points the user at it, and audits it", () => {
    const { db } = createTestDb();
    const userId = createTestUser(db);
    const image = setUploadedAvatar(db, userId, png(256, 256), "web");
    expect(image).toMatch(new RegExp(`^/api/avatars/${userId}\\?v=[\\w-]+$`));
    expect(getProfile(db, userId)?.image).toBe(image);
    const stored = getUploadedAvatar(db, userId);
    expect(stored?.contentType).toBe("image/png");
    expect([...(stored?.data ?? [])]).toEqual([...png(256, 256)]);

    // A re-upload in the same millisecond still gets a new URL, since browsers
    // cache each for good.
    vi.useFakeTimers({ toFake: ["Date"] });
    let again: string;
    try {
      const first = setUploadedAvatar(db, userId, webpLossy(256, 256), "web");
      again = setUploadedAvatar(db, userId, webpLossy(256, 256), "web");
      expect(again).not.toBe(first);
    } finally {
      vi.useRealTimers();
    }
    expect(again).not.toBe(image);
    expect(getUploadedAvatar(db, userId)?.contentType).toBe("image/webp");
    expect(profileLog(db, userId)).toEqual(
      Array(3).fill(["update", "avatar to an uploaded image", userId, "web"]),
    );
  });

  it("accepts each WebP variant up to the size limit", () => {
    const { db } = createTestDb();
    const userId = createTestUser(db);
    for (const image of [webpLossy(1024, 1), webpLossless(1, 1024), webpExtended(1024, 1024)]) {
      setUploadedAvatar(db, userId, image, "web");
      expect(getUploadedAvatar(db, userId)?.contentType).toBe("image/webp");
    }
  });

  it("rejects anything but a PNG or WebP within the size limit, changing and logging nothing", () => {
    const { db } = createTestDb();
    const userId = createTestUser(db);
    const image = setUploadedAvatar(db, userId, png(256, 256), "web");
    const svg = new TextEncoder().encode('<svg onload="alert(1)"/>'.padEnd(40));
    const jpeg = bytes([0xff, 0xd8, 0xff, 0xe0]);
    expect(() => setUploadedAvatar(db, userId, svg, "web")).toThrow(/PNG or WebP/);
    expect(() => setUploadedAvatar(db, userId, jpeg, "web")).toThrow(/PNG or WebP/);
    expect(() => setUploadedAvatar(db, userId, new Uint8Array(), "web")).toThrow(/empty/);
    // A small file declaring a huge canvas, in each layout, one past the limit.
    for (const big of [
      png(1025, 10),
      png(10, 1025),
      webpLossy(1025, 10),
      webpLossless(10, 1025),
      webpExtended(16384, 16384),
      png(0, 10),
    ]) {
      expect(() => setUploadedAvatar(db, userId, big, "web")).toThrow(/at most 1024/);
    }
    expect(getProfile(db, userId)?.image).toBe(image);
    expect(getUploadedAvatar(db, userId)?.contentType).toBe("image/png");
    expect(profileLog(db, userId)).toHaveLength(1);
  });

  it("sets a URL over an upload, dropping the upload, then removes it, auditing each real change", () => {
    const { db } = createTestDb();
    const userId = createTestUser(db);
    setUploadedAvatar(db, userId, png(64, 64), "web");

    expect(setAvatarUrl(db, userId, "example.com/me.png", "web")).toBe("https://example.com/me.png");
    expect(getUploadedAvatar(db, userId)).toBeNull();
    // Unchanged (after normalizing) and rejected values write nothing.
    setAvatarUrl(db, userId, "https://example.com/me.png", "web");
    expect(() => setAvatarUrl(db, userId, "javascript:alert(1)", "web")).toThrow(/invalid avatar URL/);
    expect(getProfile(db, userId)?.image).toBe("https://example.com/me.png");

    setAvatarUrl(db, userId, null, "web");
    setAvatarUrl(db, userId, "", "web");
    expect(getProfile(db, userId)?.image).toBeNull();
    // Same-millisecond rows can list in either order; compare as a set.
    const log = profileLog(db, userId);
    expect(log).toHaveLength(3);
    expect(log).toEqual(
      expect.arrayContaining([
        ["update", "avatar to an uploaded image", userId, "web"],
        ["update", "avatar to https://example.com/me.png", userId, "web"],
        ["delete", "avatar", userId, "web"],
      ]),
    );
  });
});

describe("username", () => {
  it("renames, keeping the typed casing for display, and audits each real change", () => {
    const { db } = createTestDb();
    const userId = createTestUser(db, { username: "fred" });
    const handle = () =>
      db.select().from(users).where(eq(users.id, userId)).get();

    setUsername(db, userId, "Fred", "web");
    expect(handle()).toMatchObject({ username: "fred", displayUsername: "Fred" });
    setUsername(db, userId, "Fred", "web"); // unchanged: no row
    setUsername(db, userId, "FredR", "web");
    expect(handle()).toMatchObject({ username: "fredr", displayUsername: "FredR" });

    const log = listAudit(db, userId)
      .filter((e) => e.entityType === "profile")
      .map((e) => [e.action, e.detail, e.actor, e.entityId, e.projectId, e.source]);
    expect(log).toHaveLength(2);
    expect(log).toEqual(
      expect.arrayContaining([
        ["update", "username from @fred to @Fred", userId, userId, null, "web"],
        ["update", "username from @Fred to @FredR", userId, userId, null, "web"],
      ]),
    );
  });

  it("rejects a handle someone else has (any casing), a reserved one, or a malformed one", () => {
    const { db } = createTestDb();
    createTestUser(db, { username: "alice" });
    const userId = createTestUser(db, { username: "bob" });
    expect(() => setUsername(db, userId, "ALICE", "web")).toThrow(/taken/);
    expect(() => setUsername(db, userId, "Admin", "web")).toThrow(/reserved/);
    expect(() => setUsername(db, userId, "bob-2", "web")).toThrow(/Letters, numbers/);
    expect(db.select().from(users).where(eq(users.id, userId)).get()?.username).toBe("bob");
    expect(listAudit(db, userId).filter((e) => e.entityType === "profile")).toEqual([]);
  });
});
