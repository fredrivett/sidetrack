import { describe, expect, it } from "vitest";
import { createTestDb, createTestUser } from "./test-helpers";
import {
  getProfile,
  getTimeZone,
  getUploadedAvatar,
  setAvatarUrl,
  setTimeZone,
  setUploadedAvatar,
} from "./users";
import { listAudit } from "./audit";

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

describe("avatar", () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 4, 5, 6]);
  const profileLog = (db: ReturnType<typeof createTestDb>["db"], userId: string) =>
    listAudit(db, userId)
      .filter((e) => e.entityType === "profile")
      .map((e) => [e.action, e.detail, e.entityId, e.source]);

  it("stores an upload by the type sniffed from its bytes, points the user at it, and audits it", () => {
    const { db } = createTestDb();
    const userId = createTestUser(db);
    const image = setUploadedAvatar(db, userId, png, "web");
    expect(image).toMatch(new RegExp(`^/api/avatars/${userId}\\?v=\\d+$`));
    expect(getProfile(db, userId)?.image).toBe(image);
    const stored = getUploadedAvatar(db, userId);
    expect(stored?.contentType).toBe("image/png");
    expect([...(stored?.data ?? [])]).toEqual([...png]);

    setUploadedAvatar(db, userId, jpeg, "web");
    expect(getUploadedAvatar(db, userId)?.contentType).toBe("image/jpeg");
    expect(profileLog(db, userId)).toEqual([
      ["update", "avatar to an uploaded image", userId, "web"],
      ["update", "avatar to an uploaded image", userId, "web"],
    ]);
  });

  it("rejects uploads that aren't raster images, such as SVG, changing and logging nothing", () => {
    const { db } = createTestDb();
    const userId = createTestUser(db);
    const image = setUploadedAvatar(db, userId, png, "web");
    const svg = new TextEncoder().encode('<svg onload="alert(1)"/>');
    expect(() => setUploadedAvatar(db, userId, svg, "web")).toThrow(/PNG, JPEG/);
    expect(() => setUploadedAvatar(db, userId, new Uint8Array(), "web")).toThrow(/empty/);
    expect(getProfile(db, userId)?.image).toBe(image);
    expect(getUploadedAvatar(db, userId)?.contentType).toBe("image/png");
    expect(profileLog(db, userId)).toHaveLength(1);
  });

  it("sets a URL over an upload, dropping the upload, then removes it, auditing each real change", () => {
    const { db } = createTestDb();
    const userId = createTestUser(db);
    setUploadedAvatar(db, userId, png, "web");

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
