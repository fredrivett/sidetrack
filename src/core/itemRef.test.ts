import { describe, expect, it } from "vitest";
import { resolveItemRef } from "./itemRef";
import { addItem } from "./items";
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
