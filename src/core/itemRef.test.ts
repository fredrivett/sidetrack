import { describe, expect, it } from "vitest";
import { projectRefPrefixes, resolveItemRef } from "./itemRef";
import { addItem } from "./items";
import { acceptInvite, inviteMember } from "./members";
import { createProject } from "./projects";
import { createTestDb, createTestUser } from "./test-helpers";

function seed() {
  const { db } = createTestDb();
  const userId = createTestUser(db, { username: "fred" });
  const project = createProject(db, userId, { name: "Engineering" }, "web");
  const item = addItem(
    db,
    userId,
    { projectId: project.id, kind: "task", title: "first" },
    "web",
  );
  return { db, userId, project, item };
}

describe("resolveItemRef", () => {
  it("resolves a bare ref, case-insensitively", () => {
    const { db, userId, item } = seed();
    const r = resolveItemRef(db, userId, "eng-1");
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.item.id).toBe(item.id);
  });

  it("resolves a qualified ref for the requester's own username", () => {
    const { db, userId, item } = seed();
    const r = resolveItemRef(db, userId, "fred/ENG-1");
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.item.id).toBe(item.id);
  });

  it("rejects a qualified ref for another username", () => {
    const { db, userId } = seed();
    const r = resolveItemRef(db, userId, "someoneelse/ENG-1");
    expect(r).toEqual({ status: "not_found", reason: "user" });
  });

  it("resolves a ref whose prefix was auto-suffixed on collision", () => {
    const { db, userId } = seed(); // owns "Engineering" → ENG
    const second = createProject(db, userId, { name: "Engineering" }, "web");
    expect(second.prefix).toBe("ENG2");
    const item = addItem(
      db,
      userId,
      { projectId: second.id, kind: "task", title: "x" },
      "web",
    );
    const r = resolveItemRef(db, userId, "ENG2-1");
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.item.id).toBe(item.id);
  });

  it("falls back to a raw nanoid id", () => {
    const { db, userId, item } = seed();
    const r = resolveItemRef(db, userId, item.id);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.item.id).toBe(item.id);
  });

  it("reports not_found for unknown prefix, number, and unparseable input", () => {
    const { db, userId } = seed();
    expect(resolveItemRef(db, userId, "ZZZ-1")).toEqual({
      status: "not_found",
      reason: "prefix",
    });
    expect(resolveItemRef(db, userId, "ENG-999")).toEqual({
      status: "not_found",
      reason: "number",
    });
    expect(resolveItemRef(db, userId, "not-an-id")).toEqual({
      status: "not_found",
      reason: "format",
    });
  });

  it("does not resolve another owner's item", () => {
    const { db, item } = seed();
    const other = createTestUser(db, { username: "bob", email: "bob@test.local" });
    // Bob owns no ENG project and can't reach fred's item by id either.
    expect(resolveItemRef(db, other, "ENG-1")).toEqual({
      status: "not_found",
      reason: "prefix",
    });
    expect(resolveItemRef(db, other, item.id)).toEqual({
      status: "not_found",
      reason: "format",
    });
  });
});

// fred owns "Engineering" (ENG) with one item; bob is an accepted member.
function seedShared() {
  const { db } = createTestDb();
  const fred = createTestUser(db, { username: "fred" });
  const bob = createTestUser(db, { username: "bob", email: "bob@test.local" });
  const project = createProject(db, fred, { name: "Engineering" }, "web");
  const item = addItem(
    db,
    fred,
    { projectId: project.id, kind: "task", title: "shared task" },
    "web",
  );
  inviteMember(db, fred, project.id, "bob", "web");
  acceptInvite(db, bob, project.id, "web");
  return { db, fred, bob, project, item };
}

describe("resolveItemRef with shared projects", () => {
  it("a member resolves a shared item by bare ref when there's no clash", () => {
    const { db, bob, item } = seedShared();
    const r = resolveItemRef(db, bob, "ENG-1");
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.item.id).toBe(item.id);
  });

  it("a member resolves a shared item by the owner-qualified ref", () => {
    const { db, bob, item } = seedShared();
    const r = resolveItemRef(db, bob, "fred/ENG-1");
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.item.id).toBe(item.id);
  });

  it("a bare ref is ambiguous when the member's own prefix clashes", () => {
    const { db, bob } = seedShared();
    // Bob also owns an ENG project → "ENG-1" now matches two accessible boards.
    const own = createProject(db, bob, { name: "Engineering" }, "web");
    const mine = addItem(
      db,
      bob,
      { projectId: own.id, kind: "task", title: "mine" },
      "web",
    );

    const r = resolveItemRef(db, bob, "ENG-1");
    expect(r.status).toBe("ambiguous");
    if (r.status === "ambiguous") {
      expect(r.candidates.map((c) => c.ownerUsername).sort()).toEqual([
        "bob",
        "fred",
      ]);
    }

    // Qualifying with each owner pins it unambiguously.
    const fredRef = resolveItemRef(db, bob, "fred/ENG-1");
    const bobRef = resolveItemRef(db, bob, "bob/ENG-1");
    expect(fredRef.status).toBe("ok");
    expect(bobRef.status).toBe("ok");
    if (bobRef.status === "ok") expect(bobRef.item.id).toBe(mine.id);
  });
});

describe("projectRefPrefixes", () => {
  it("is bare with no clash, owner-qualified on a clash, per viewer", () => {
    const { db, fred, bob, project } = seedShared();
    // No clash yet: both see a single ENG, so it stays bare for everyone.
    expect(projectRefPrefixes(db, fred)[project.id]).toBe("ENG");
    expect(projectRefPrefixes(db, bob)[project.id]).toBe("ENG");

    // Bob adds his own ENG → clash on bob's board only.
    const own = createProject(db, bob, { name: "Engineering" }, "web");
    const bobPrefixes = projectRefPrefixes(db, bob);
    expect(bobPrefixes[project.id]).toBe("fred/ENG");
    expect(bobPrefixes[own.id]).toBe("bob/ENG");
    // Fred's board is unaffected — he still sees only his own ENG.
    expect(projectRefPrefixes(db, fred)[project.id]).toBe("ENG");
  });
});
