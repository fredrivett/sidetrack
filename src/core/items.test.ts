import { describe, expect, it } from "vitest";
import { listAudit } from "./audit";
import {
  addItem,
  completeItem,
  deleteItem,
  getItem,
  listItems,
  reorderItem,
  uncompleteItem,
  updateItem,
} from "./items";
import { createProject } from "./projects";
import { createTestDb, createTestUser } from "./test-helpers";

function seedProject() {
  const { db } = createTestDb();
  const userId = createTestUser(db);
  const p = createProject(db, userId, { name: "P" }, "web");
  return { db, userId, projectId: p.id };
}

describe("items", () => {
  it("appends to the end of the active range by default", () => {
    const { db, userId, projectId } = seedProject();
    addItem(db, userId, { projectId, kind: "task", title: "first" }, "web");
    addItem(db, userId, { projectId, kind: "task", title: "second" }, "web");
    expect(listItems(db, userId, projectId).map((i) => i.title)).toEqual([
      "first",
      "second",
    ]);
  });

  it("honours positionRef: 'top'", () => {
    const { db, userId, projectId } = seedProject();
    addItem(db, userId, { projectId, kind: "task", title: "first" }, "web");
    addItem(
      db,
      userId,
      { projectId, kind: "task", title: "above", positionRef: "top" },
      "web",
    );
    expect(listItems(db, userId, projectId).map((i) => i.title)).toEqual([
      "above",
      "first",
    ]);
  });

  it("auto-creates inline categories without auditing them", () => {
    const { db, userId, projectId } = seedProject();
    const item = addItem(
      db,
      userId,
      { projectId, kind: "task", title: "with cat", category: "infra" },
      "web",
    );
    const log = listAudit(db, userId);
    expect(log.find((e) => e.entityId === item.id)?.action).toBe("create");
    // ensureCategory is intentionally NOT audited — the parent create is the
    // logged event.
    expect(log.some((e) => e.entityType === "category")).toBe(false);
  });

  it("completes then uncompletes, logging both actions", () => {
    const { db, userId, projectId } = seedProject();
    const item = addItem(
      db,
      userId,
      { projectId, kind: "task", title: "toggle" },
      "web",
    );
    completeItem(db, userId, item.id, "mcp");
    uncompleteItem(db, userId, item.id, "web");
    const actions = listAudit(db, userId, { projectId })
      .filter((e) => e.entityId === item.id)
      .map((e) => e.action);
    expect(actions).toEqual(["uncomplete", "complete", "create"]);
  });

  it("skips audit on no-op updates", () => {
    const { db, userId, projectId } = seedProject();
    const item = addItem(
      db,
      userId,
      { projectId, kind: "task", title: "same" },
      "web",
    );
    const before = listAudit(db, userId).length;
    updateItem(db, userId, item.id, { title: "same" }, "web");
    expect(listAudit(db, userId).length).toBe(before);
  });

  it("rejects a blank title on create", () => {
    const { db, userId, projectId } = seedProject();
    expect(() =>
      addItem(db, userId, { projectId, kind: "task", title: "   " }, "web"),
    ).toThrow(/title cannot be empty/);
  });

  it("rejects clearing the title on update and leaves it unchanged", () => {
    const { db, userId, projectId } = seedProject();
    const item = addItem(
      db,
      userId,
      { projectId, kind: "task", title: "keep me" },
      "web",
    );
    expect(() =>
      updateItem(db, userId, item.id, { title: "  " }, "web"),
    ).toThrow(/title cannot be empty/);
    expect(getItem(db, userId, item.id)?.title).toBe("keep me");
  });

  it("reorders to end", () => {
    const { db, userId, projectId } = seedProject();
    const a = addItem(db, userId, { projectId, kind: "task", title: "a" }, "web");
    addItem(db, userId, { projectId, kind: "task", title: "b" }, "web");
    reorderItem(db, userId, a.id, "end", "web");
    expect(listItems(db, userId, projectId).map((i) => i.title)).toEqual([
      "b",
      "a",
    ]);
  });

  it("returns undefined for an empty or unknown id", () => {
    const { db, userId, projectId } = seedProject();
    addItem(db, userId, { projectId, kind: "task", title: "real" }, "web");
    // An empty id must not fall through to "match any owned item".
    expect(getItem(db, userId, "")).toBeUndefined();
    expect(getItem(db, userId, "nope")).toBeUndefined();
  });

  it("numbers items monotonically per project, never reusing after delete", () => {
    const { db, userId, projectId } = seedProject();
    const a = addItem(db, userId, { projectId, kind: "task", title: "a" }, "web");
    const b = addItem(db, userId, { projectId, kind: "task", title: "b" }, "web");
    expect([a.number, b.number]).toEqual([1, 2]);

    // Deleting b must not hand its number back to the next item.
    deleteItem(db, userId, b.id, "web");
    const c = addItem(db, userId, { projectId, kind: "task", title: "c" }, "web");
    expect(c.number).toBe(3);
  });

  it("numbers each project independently", () => {
    const { db, userId, projectId } = seedProject();
    const other = createProject(db, userId, { name: "Other" }, "web");
    const a = addItem(db, userId, { projectId, kind: "task", title: "a" }, "web");
    const b = addItem(
      db,
      userId,
      { projectId: other.id, kind: "task", title: "b" },
      "web",
    );
    // Both projects start their own sequence at 1.
    expect(a.number).toBe(1);
    expect(b.number).toBe(1);
  });

  it("deletes an item and logs it", () => {
    const { db, userId, projectId } = seedProject();
    const item = addItem(
      db,
      userId,
      { projectId, kind: "task", title: "rm" },
      "web",
    );
    deleteItem(db, userId, item.id, "mcp");
    expect(listItems(db, userId, projectId)).toEqual([]);
    const last = listAudit(db, userId).find((e) => e.entityId === item.id);
    expect(last?.action).toBe("delete");
    expect(last?.source).toBe("mcp");
  });
});
