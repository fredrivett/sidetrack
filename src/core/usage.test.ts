import { nanoid } from "nanoid";
import { describe, expect, it } from "vitest";
import { SYSTEM_ACTOR } from "./audit";
import { apiKeys, sessions } from "./auth-schema";
import { auditLog } from "./schema";
import { createTestDb, createTestUser } from "./test-helpers";
import { dailyUsage } from "./usage";

type TestDb = ReturnType<typeof createTestDb>["db"];

function change(db: TestDb, actor: string, iso: string, agentName?: string) {
  db.insert(auditLog)
    .values({
      id: nanoid(12),
      ts: Date.parse(iso),
      actor,
      source: agentName ? "mcp" : "web",
      agentName,
      action: "update",
      entityType: "item",
      entityId: "i1",
    })
    .run();
}

describe("dailyUsage", () => {
  it("counts each person's changes per day in the viewer's time zone", () => {
    const { db } = createTestDb();
    const ann = createTestUser(db, { name: "Ann" });
    const bob = createTestUser(db, { name: "Bob" });
    const idle = createTestUser(db, { name: "Idle" });
    // 23:30 UTC is already the next day in Paris (UTC+1 in November).
    change(db, ann, "2026-11-20T23:30:00Z");
    change(db, ann, "2026-11-21T10:00:00Z");
    change(db, ann, "2026-11-22T09:00:00Z");
    change(db, bob, "2026-11-20T12:00:00Z");
    // Before the range: not counted, but still their last change.
    change(db, bob, "2026-11-10T12:00:00Z");
    // Nobody's: not counted for anyone.
    change(db, SYSTEM_ACTOR, "2026-11-21T12:00:00Z");

    const usage = dailyUsage(db, {
      days: 3,
      timeZone: "Europe/Paris",
      now: Date.parse("2026-11-22T12:00:00Z"),
    });

    expect(usage.days).toEqual(["2026-11-20", "2026-11-21", "2026-11-22"]);
    expect(usage.users.map((u) => [u.name, u.perDay, u.total])).toEqual([
      ["Ann", [0, 2, 1], 3],
      ["Bob", [1, 0, 0], 1],
      ["Idle", [0, 0, 0], 0],
    ]);
    expect(usage.users.find((u) => u.id === idle)?.lastActiveAt).toBeNull();
    expect(usage.users.find((u) => u.id === bob)?.lastActiveAt).toBe(Date.parse("2026-11-20T12:00:00Z"));
  });

  it("counts changes made through agents, and when each person was last seen", () => {
    const { db } = createTestDb();
    const ann = createTestUser(db, { name: "Ann" });
    const bob = createTestUser(db, { name: "Bob" });
    const cat = createTestUser(db, { name: "Cat" });
    change(db, ann, "2026-11-21T10:00:00Z");
    change(db, ann, "2026-11-21T11:00:00Z", "Amp");
    change(db, ann, "2026-11-22T09:00:00Z", "Claude");
    change(db, ann, "2026-11-22T09:05:00Z", "Claude");
    // Ann's latest sign-in is older than her last change: the change wins.
    const at = (iso: string) => new Date(iso);
    for (const [userId, updated] of [
      [ann, "2026-11-20T08:00:00Z"],
      [bob, "2026-11-19T08:00:00Z"],
      [bob, "2026-11-21T08:00:00Z"],
    ] as const) {
      db.insert(sessions)
        .values({ id: nanoid(), token: nanoid(), userId, createdAt: at("2026-11-01T00:00:00Z"), updatedAt: at(updated), expiresAt: at("2026-12-01T00:00:00Z") })
        .run();
    }
    // Cat only uses an agent key, which made no change.
    db.insert(apiKeys)
      .values({ id: nanoid(), userId: cat, name: "Amp", prefix: "sk_x", keyHash: nanoid(), createdAt: at("2026-11-01T00:00:00Z"), lastUsedAt: at("2026-11-22T11:00:00Z") })
      .run();

    const usage = dailyUsage(db, { days: 2, timeZone: "UTC", now: Date.parse("2026-11-22T12:00:00Z") });
    const of = (id: string) => usage.users.find((u) => u.id === id) ?? expect.fail(`no row for ${id}`);
    expect([of(ann).agentPerDay, of(ann).agentTotal, of(ann).total, of(ann).agents]).toEqual([[1, 2], 3, 4, ["Claude", "Amp"]]);
    expect(of(ann).lastSeenAt).toBe(Date.parse("2026-11-22T09:05:00Z"));
    expect(of(bob).lastSeenAt).toBe(Date.parse("2026-11-21T08:00:00Z"));
    expect(of(cat).lastSeenAt).toBe(Date.parse("2026-11-22T11:00:00Z"));
    expect([of(cat).agentTotal, of(cat).agents]).toEqual([0, []]);
  });

  it("splits days at midnight in a time zone off the hour", () => {
    const { db } = createTestDb();
    const ann = createTestUser(db);
    // Kathmandu is UTC+5:45, so its midnight is 18:15 UTC.
    change(db, ann, "2026-11-20T18:14:00Z");
    change(db, ann, "2026-11-20T18:16:00Z");
    const usage = dailyUsage(db, {
      days: 2,
      timeZone: "Asia/Kathmandu",
      now: Date.parse("2026-11-21T12:00:00Z"),
    });
    expect(usage.users[0].perDay).toEqual([1, 1]);
  });

  it("keeps every calendar day across a daylight-saving change", () => {
    const { db } = createTestDb();
    const usage = dailyUsage(db, {
      days: 3,
      timeZone: "Europe/London",
      // Clocks went back on 25 October, a 25-hour day.
      now: Date.parse("2026-10-26T00:30:00Z"),
    });
    expect(usage.days).toEqual(["2026-10-24", "2026-10-25", "2026-10-26"]);
  });
});
