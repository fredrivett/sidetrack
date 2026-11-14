import { describe, expect, it } from "vitest";
import { createTestDb, createTestUser } from "./test-helpers";
import { getTimeZone, setTimeZone } from "./users";

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
