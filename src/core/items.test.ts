import { describe, expect, it } from "vitest";
import { listAudit } from "./audit";
import {
  addItem,
  completeItem,
  deleteItem,
  listItems,
  reorderItem,
  uncompleteItem,
  updateItem,
} from "./items";
import { createProject } from "./projects";
import { createTestDb } from "./test-helpers";

function seedProject() {
  const { db } = createTestDb();
  const p = createProject(db, { name: "P" }, "web");
  return { db, projectId: p.id };
}

describe("items", () => {
  it("appends to the end of the active range by default", () => {
    const { db, projectId } = seedProject();
    addItem(db, { projectId, kind: "task", title: "first" }, "web");
    addItem(db, { projectId, kind: "task", title: "second" }, "web");
    expect(listItems(db, projectId).map((i) => i.title)).toEqual([
      "first",
      "second",
    ]);
  });

  it("honours positionRef: 'top'", () => {
    const { db, projectId } = seedProject();
    addItem(db, { projectId, kind: "task", title: "first" }, "web");
    addItem(
      db,
      { projectId, kind: "task", title: "above", positionRef: "top" },
      "web",
    );
    expect(listItems(db, projectId).map((i) => i.title)).toEqual([
      "above",
      "first",
    ]);
  });

  it("auto-creates inline categories without auditing them", () => {
    const { db, projectId } = seedProject();
    const item = addItem(
      db,
      { projectId, kind: "task", title: "with cat", category: "infra" },
      "web",
    );
    const log = listAudit(db);
    expect(log.find((e) => e.entityId === item.id)?.action).toBe("create");
    // ensureCategory is intentionally NOT audited — the parent create is the
    // logged event.
    expect(log.some((e) => e.entityType === "category")).toBe(false);
  });

  it("completes then uncompletes, logging both actions", () => {
    const { db, projectId } = seedProject();
    const item = addItem(
      db,
      { projectId, kind: "task", title: "toggle" },
      "web",
    );
    completeItem(db, item.id, "mcp");
    uncompleteItem(db, item.id, "web");
    const actions = listAudit(db, { projectId })
      .filter((e) => e.entityId === item.id)
      .map((e) => e.action);
    expect(actions).toEqual(["uncomplete", "complete", "create"]);
  });

  it("skips audit on no-op updates", () => {
    const { db, projectId } = seedProject();
    const item = addItem(
      db,
      { projectId, kind: "task", title: "same" },
      "web",
    );
    const before = listAudit(db).length;
    updateItem(db, item.id, { title: "same" }, "web");
    expect(listAudit(db).length).toBe(before);
  });

  it("reorders to end", () => {
    const { db, projectId } = seedProject();
    const a = addItem(db, { projectId, kind: "task", title: "a" }, "web");
    addItem(db, { projectId, kind: "task", title: "b" }, "web");
    reorderItem(db, a.id, "end", "web");
    expect(listItems(db, projectId).map((i) => i.title)).toEqual(["b", "a"]);
  });

  it("deletes an item and logs it", () => {
    const { db, projectId } = seedProject();
    const item = addItem(db, { projectId, kind: "task", title: "rm" }, "web");
    deleteItem(db, item.id, "mcp");
    expect(listItems(db, projectId)).toEqual([]);
    const last = listAudit(db).find((e) => e.entityId === item.id);
    expect(last?.action).toBe("delete");
    expect(last?.source).toBe("mcp");
  });
});
