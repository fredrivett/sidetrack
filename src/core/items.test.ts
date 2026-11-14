import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { listAudit } from "./audit";
import {
  addItem,
  completeItem,
  deleteItem,
  getItem,
  listItems,
  reorderItem,
  setItemParent,
  uncompleteItem,
  updateItem,
} from "./items";
import { acceptInvite, inviteMember, listAssignees } from "./members";
import {
  createProject,
  listNoDate,
  listToday,
  reorderProject,
  updateProject,
} from "./projects";
import { items } from "./schema";
import { nestItems } from "../lib/itemTree";
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

  it("keeps a completed item in place, and reopening leaves it there", () => {
    const { db, userId, projectId } = seedProject();
    const add = (title: string) =>
      addItem(db, userId, { projectId, kind: "task", title }, "web");
    add("a");
    const b = add("b");
    add("c");
    const all = () =>
      listItems(db, userId, projectId, { includeCompleted: true }).map(
        (i) => i.title,
      );

    completeItem(db, userId, b.id, "web");
    expect(getItem(db, userId, b.id)?.position).toBe(b.position);
    expect(all()).toEqual(["a", "b", "c"]);

    uncompleteItem(db, userId, b.id, "web");
    expect(getItem(db, userId, b.id)?.position).toBe(b.position);
    expect(all()).toEqual(["a", "b", "c"]);
  });

  it("'top' lands first even above finished items", () => {
    const { db, userId, projectId } = seedProject();
    const done = addItem(
      db,
      userId,
      { projectId, kind: "task", title: "done" },
      "web",
    );
    const open = addItem(
      db,
      userId,
      { projectId, kind: "task", title: "open" },
      "web",
    );
    completeItem(db, userId, done.id, "web");
    addItem(
      db,
      userId,
      { projectId, kind: "task", title: "new", positionRef: "top" },
      "web",
    );
    reorderItem(db, userId, open.id, "top", "web");
    expect(
      listItems(db, userId, projectId, { includeCompleted: true }).map(
        (i) => i.title,
      ),
    ).toEqual(["open", "new", "done"]);
  });

  it("orders tied positions by id and can still place next to them", () => {
    const { db, userId, projectId } = seedProject();
    const add = (title: string) =>
      addItem(db, userId, { projectId, kind: "task", title }, "web");
    const a = add("a");
    const b = add("b");
    const c = add("c");
    // Two concurrent inserts into the same gap can produce equal keys.
    db.update(items).set({ position: a.position }).where(eq(items.id, b.id)).run();
    const [first, second] = [a, b].sort((x, y) => (x.id < y.id ? -1 : 1));
    const titles = () => listItems(db, userId, projectId).map((i) => i.title);
    expect(titles()).toEqual([first.title, second.title, "c"]);

    // No key sorts strictly between two equal ones, so these land beyond the
    // tied run rather than throwing.
    reorderItem(db, userId, c.id, `after:${first.id}`, "web");
    expect(titles()).toEqual([first.title, second.title, "c"]);
    reorderItem(db, userId, c.id, `before:${second.id}`, "web");
    expect(titles()).toEqual(["c", first.title, second.title]);
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

  it("places next to a middle item, and rejects unknown anchors and bad refs", () => {
    const { db, userId, projectId } = seedProject();
    const add = (title: string) =>
      addItem(db, userId, { projectId, kind: "task", title }, "web");
    add("a");
    const b = add("b");
    add("c");
    const d = add("d");
    const titles = () => listItems(db, userId, projectId).map((i) => i.title);

    reorderItem(db, userId, d.id, `after:${b.id}`, "web");
    expect(titles()).toEqual(["a", "b", "d", "c"]);
    reorderItem(db, userId, d.id, `before:${b.id}`, "web");
    expect(titles()).toEqual(["a", "d", "b", "c"]);

    expect(() => reorderItem(db, userId, d.id, "after:nope", "web")).toThrow(
      /anchor not found/,
    );
    expect(() => reorderItem(db, userId, d.id, "middle", "web")).toThrow(
      /invalid position ref/,
    );
    expect(titles()).toEqual(["a", "d", "b", "c"]);
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

describe("item assignment", () => {
  // Owner + an accepted member (alice) + a stranger (bob) with no access.
  function seedShared() {
    const { db } = createTestDb();
    const owner = createTestUser(db, { username: "owner" });
    const alice = createTestUser(db, { username: "alice" });
    const bob = createTestUser(db, { username: "bob" });
    const projectId = createProject(db, owner, { name: "P" }, "web").id;
    inviteMember(db, owner, projectId, "alice", "web");
    acceptInvite(db, alice, projectId, "web");
    const item = addItem(
      db,
      owner,
      { projectId, kind: "task", title: "do it" },
      "web",
    );
    return { db, owner, alice, bob, projectId, item };
  }

  it("is unassigned by default", () => {
    const { item } = seedShared();
    expect(item.assigneeId).toBeNull();
  });

  it("assigns to an accepted member and audits with their handle", () => {
    const { db, owner, alice, item } = seedShared();
    const updated = updateItem(db, owner, item.id, { assigneeId: alice }, "web");
    expect(updated.assigneeId).toBe(alice);
    const last = listAudit(db, owner).find((e) => e.entityId === item.id);
    expect(last?.action).toBe("update");
    expect(last?.detail).toContain("assigned to @alice");
  });

  it("lets the owner assign to themselves", () => {
    const { db, owner, item } = seedShared();
    expect(
      updateItem(db, owner, item.id, { assigneeId: owner }, "web").assigneeId,
    ).toBe(owner);
  });

  it("rejects assigning to a user without project access", () => {
    const { db, owner, bob, item } = seedShared();
    expect(() =>
      updateItem(db, owner, item.id, { assigneeId: bob }, "web"),
    ).toThrow(/does not have access/);
  });

  it("rejects assigning to a pending (not-yet-accepted) invitee", () => {
    const { db } = createTestDb();
    const owner = createTestUser(db, { username: "owner" });
    const carol = createTestUser(db, { username: "carol" });
    const projectId = createProject(db, owner, { name: "P" }, "web").id;
    inviteMember(db, owner, projectId, "carol", "web");
    const item = addItem(
      db,
      owner,
      { projectId, kind: "task", title: "x" },
      "web",
    );
    expect(() =>
      updateItem(db, owner, item.id, { assigneeId: carol }, "web"),
    ).toThrow(/does not have access/);
  });

  it("unassigns and audits the clear", () => {
    const { db, owner, alice, item } = seedShared();
    updateItem(db, owner, item.id, { assigneeId: alice }, "web");
    const cleared = updateItem(db, owner, item.id, { assigneeId: null }, "web");
    expect(cleared.assigneeId).toBeNull();
    const last = listAudit(db, owner).find((e) => e.entityId === item.id);
    expect(last?.detail).toContain("unassigned");
  });

  it("treats re-assigning the same user as a no-op (no audit row)", () => {
    const { db, owner, alice, item } = seedShared();
    updateItem(db, owner, item.id, { assigneeId: alice }, "web");
    const before = listAudit(db, owner).filter(
      (e) => e.entityId === item.id,
    ).length;
    updateItem(db, owner, item.id, { assigneeId: alice }, "web");
    const after = listAudit(db, owner).filter(
      (e) => e.entityId === item.id,
    ).length;
    expect(after).toBe(before);
  });

  it("listAssignees returns the owner first, then accepted members only", () => {
    const { db, owner, alice, projectId } = seedShared();
    // A pending invitee must not appear in the assignable pool.
    const dave = createTestUser(db, { username: "dave" });
    inviteMember(db, owner, projectId, "dave", "web");
    const assignees = listAssignees(db, owner, projectId);
    expect(assignees.map((a) => a.userId)).toEqual([owner, alice]);
    expect(assignees[0].isOwner).toBe(true);
    expect(assignees[1].isOwner).toBe(false);
    expect(assignees.some((a) => a.userId === dave)).toBe(false);
  });

  it("a member can assign within a shared project", () => {
    const { db, alice, owner, item } = seedShared();
    // alice (an accepted member) assigns the item to the owner.
    expect(
      updateItem(db, alice, item.id, { assigneeId: owner }, "web").assigneeId,
    ).toBe(owner);
  });
});

describe("checklists (sub-items)", () => {
  function setup() {
    const { db, userId, projectId } = seedProject();
    const add = (title: string, opts: { parentId?: string; positionRef?: string; kind?: "task" | "milestone" } = {}) =>
      addItem(
        db,
        userId,
        { projectId, kind: opts.kind ?? "task", title, parentId: opts.parentId, positionRef: opts.positionRef },
        "web",
      );
    const tree = () =>
      nestItems(listItems(db, userId, projectId, { includeCompleted: true })).map(
        (i) => [i.title, i.children.map((c) => c.title)],
      );
    return { db, userId, projectId, add, tree };
  }

  it("orders sub-items among their siblings only", () => {
    const { add, tree } = setup();
    const a = add("a");
    add("b");
    const a2 = add("a2", { parentId: a.id });
    add("a1", { parentId: a.id, positionRef: "top" });
    add("a1.5", { parentId: a.id, positionRef: `before:${a2.id}` });
    add("c");
    expect(tree()).toEqual([
      ["a", ["a1", "a1.5", "a2"]],
      ["b", []],
      ["c", []],
    ]);
  });

  it("completing a parent ticks its open sub-items, keeping earlier ticks", () => {
    const { db, userId, projectId, add } = setup();
    const p = add("tidy");
    const lounge = add("lounge", { parentId: p.id });
    const kitchen = add("kitchen", { parentId: p.id });
    completeItem(db, userId, lounge.id, "web");
    const loungeDoneAt = getItem(db, userId, lounge.id)?.completedAt;

    completeItem(db, userId, p.id, "mcp");
    expect(getItem(db, userId, kitchen.id)?.completedAt).not.toBeNull();
    expect(getItem(db, userId, lounge.id)?.completedAt).toBe(loungeDoneAt);
    const completes = listAudit(db, userId, { projectId })
      .filter((e) => e.action === "complete")
      .map((e) => e.entityId);
    expect(completes.sort()).toEqual([lounge.id, kitchen.id, p.id].sort());
  });

  it("ticking every sub-item leaves the parent open", () => {
    const { db, userId, add } = setup();
    const p = add("tidy");
    const c = add("lounge", { parentId: p.id });
    completeItem(db, userId, c.id, "web");
    expect(getItem(db, userId, p.id)?.completedAt).toBeNull();
  });

  it("reopening or adding a sub-item reopens a finished parent", () => {
    const { db, userId, projectId, add } = setup();
    const p = add("tidy");
    const c = add("lounge", { parentId: p.id });
    const reopens = () =>
      listAudit(db, userId, { projectId }).filter(
        (e) => e.action === "uncomplete" && e.entityId === p.id,
      ).length;
    // An open parent isn't "reopened".
    expect(reopens()).toBe(0);
    completeItem(db, userId, p.id, "web");

    uncompleteItem(db, userId, c.id, "web");
    expect(getItem(db, userId, p.id)?.completedAt).toBeNull();

    expect(reopens()).toBe(1);

    completeItem(db, userId, p.id, "web");
    add("bedroom", { parentId: p.id });
    expect(getItem(db, userId, p.id)?.completedAt).toBeNull();
    expect(reopens()).toBe(2);
    // The other sub-item stays ticked.
    expect(getItem(db, userId, c.id)?.completedAt).not.toBeNull();
  });

  it("nesting an open item under a finished parent reopens it; a finished one doesn't", () => {
    const { db, userId, add } = setup();
    const p = add("tidy");
    const done = add("hoover");
    const open = add("dust");
    completeItem(db, userId, p.id, "web");
    completeItem(db, userId, done.id, "web");

    setItemParent(db, userId, done.id, p.id, "web");
    expect(getItem(db, userId, p.id)?.completedAt).not.toBeNull();
    setItemParent(db, userId, open.id, p.id, "web");
    expect(getItem(db, userId, p.id)?.completedAt).toBeNull();
  });

  it("reopening a parent leaves its sub-items ticked", () => {
    const { db, userId, add } = setup();
    const p = add("tidy");
    const c = add("lounge", { parentId: p.id });
    completeItem(db, userId, p.id, "web");
    uncompleteItem(db, userId, p.id, "web");
    expect(getItem(db, userId, c.id)?.completedAt).not.toBeNull();
  });

  it("is one level deep, tasks only, and within one list", () => {
    const { db, userId, add } = setup();
    const p = add("tidy");
    const c = add("lounge", { parentId: p.id });
    expect(() => add("rug", { parentId: c.id })).toThrow(/already a sub-item/);
    expect(() => add("v1", { parentId: p.id, kind: "milestone" })).toThrow(/only tasks/);
    const m = add("launch", { kind: "milestone" });
    expect(() => add("x", { parentId: m.id })).toThrow(/only tasks/);

    const other = createProject(db, userId, { name: "Other" }, "web");
    expect(() =>
      addItem(db, userId, { projectId: other.id, kind: "task", title: "x", parentId: p.id }, "web"),
    ).toThrow(/same list/);
  });

  it("nests an item last under a parent and moves it back out after the parent", () => {
    const { db, userId, projectId, add, tree } = setup();
    const a = add("a");
    add("a1", { parentId: a.id });
    const b = add("b");
    add("c");

    setItemParent(db, userId, b.id, a.id, "web");
    expect(tree()).toEqual([
      ["a", ["a1", "b"]],
      ["c", []],
    ]);
    setItemParent(db, userId, b.id, null, "web");
    expect(tree()).toEqual([
      ["a", ["a1"]],
      ["b", []],
      ["c", []],
    ]);

    // No-op: already top-level, so nothing is logged.
    const before = listAudit(db, userId, { projectId }).length;
    setItemParent(db, userId, b.id, null, "web");
    expect(listAudit(db, userId, { projectId })).toHaveLength(before);

    // An item with sub-items can't become one, and nothing nests under itself.
    expect(() => setItemParent(db, userId, a.id, b.id, "web")).toThrow(/has sub-items/);
    expect(() => setItemParent(db, userId, b.id, b.id, "web")).toThrow(/own sub-item/);
  });

  it("nests and moves out at a given position, as a drop does", () => {
    const { db, userId, projectId, add, tree } = setup();
    const a = add("a");
    const a1 = add("a1", { parentId: a.id });
    add("a2", { parentId: a.id });
    const b = add("b");
    const c = add("c");
    const d = add("d");

    // Into a's checklist between a1 and a2, not at its end.
    setItemParent(db, userId, c.id, a.id, "web", `after:${a1.id}`);
    expect(tree()).toEqual([
      ["a", ["a1", "c", "a2"]],
      ["b", []],
      ["d", []],
    ]);
    // Straight from one checklist into another, at its top rather than its end.
    setItemParent(db, userId, d.id, b.id, "web");
    setItemParent(db, userId, a1.id, b.id, "web", "top");
    // Out to the top level after b, rather than after its old parent a.
    setItemParent(db, userId, c.id, null, "web", `after:${b.id}`);
    expect(tree()).toEqual([
      ["a", ["a2"]],
      ["b", ["a1", "d"]],
      ["c", []],
    ]);
    // Each move is one audited update.
    const updates = () =>
      listAudit(db, userId, { projectId }).filter((e) => e.action === "update").length;
    expect(updates()).toBe(4);

    // The anchor must be a sibling at the destination; nothing changes otherwise.
    expect(() => setItemParent(db, userId, c.id, a.id, "web", `after:${b.id}`)).toThrow(
      /anchor not found/,
    );
    expect(getItem(db, userId, c.id)?.parentId).toBeNull();
    expect(updates()).toBe(4);
  });

  it("reorders a sub-item only among its siblings", () => {
    const { db, userId, add, tree } = setup();
    const a = add("a");
    const a1 = add("a1", { parentId: a.id });
    add("a2", { parentId: a.id });
    const b = add("b");
    reorderItem(db, userId, a1.id, "end", "web");
    expect(tree()).toEqual([
      ["a", ["a2", "a1"]],
      ["b", []],
    ]);
    expect(() => reorderItem(db, userId, a1.id, `after:${b.id}`, "web")).toThrow(
      /anchor not found/,
    );
  });

  it("deleting a parent deletes and logs its sub-items", () => {
    const { db, userId, projectId, add } = setup();
    const p = add("tidy");
    const c = add("lounge", { parentId: p.id });
    deleteItem(db, userId, p.id, "web");
    expect(getItem(db, userId, c.id)).toBeUndefined();
    const deleted = listAudit(db, userId, { projectId })
      .filter((e) => e.action === "delete")
      .map((e) => e.entityId);
    expect(deleted.sort()).toEqual([c.id, p.id].sort());
  });
});

describe("due dates and Today", () => {
  it("sets, validates and clears a due date, auditing each change once", () => {
    const { db, userId, projectId } = seedProject();
    const it1 = addItem(
      db,
      userId,
      { projectId, kind: "task", title: "bins", dueDate: "2026-11-14" },
      "web",
    );
    expect(it1.dueDate).toBe("2026-11-14");
    expect(
      listAudit(db, userId, { projectId }).find(
        (e) => e.entityId === it1.id && e.action === "create",
      )?.detail,
    ).toBe('added task "bins", due 2026-11-14');
    expect(() =>
      updateItem(db, userId, it1.id, { dueDate: "2026-02-30" }, "web"),
    ).toThrow(/invalid due date/);
    expect(() =>
      addItem(db, userId, { projectId, kind: "task", title: "x", dueDate: "14/11" }, "web"),
    ).toThrow(/invalid due date/);

    const updates = () =>
      listAudit(db, userId, { projectId }).filter(
        (e) => e.entityId === it1.id && e.action === "update",
      );
    updateItem(db, userId, it1.id, { dueDate: "2026-11-14" }, "web");
    expect(updates()).toHaveLength(0);
    updateItem(db, userId, it1.id, { dueDate: "2026-11-20" }, "web");
    updateItem(db, userId, it1.id, { dueDate: null }, "web");
    expect(getItem(db, userId, it1.id)?.dueDate).toBeNull();
    expect(updates().map((e) => e.detail)).toEqual([
      "bins: due date cleared",
      "bins: due 2026-11-20",
    ]);
  });

  it("lists Today across active lists: overdue first, open or done today", () => {
    const { db } = createTestDb();
    const userId = createTestUser(db);
    const home = createProject(db, userId, { name: "Home" }, "web");
    const work = createProject(db, userId, { name: "Work" }, "web");
    const paused = createProject(db, userId, { name: "Later" }, "web");
    updateProject(db, userId, paused.id, { status: "paused" }, "web");
    const archived = createProject(db, userId, { name: "Old" }, "web");
    updateProject(db, userId, archived.id, { status: "archived" }, "web");
    const add = (projectId: string, title: string, dueDate: string | null) =>
      addItem(db, userId, { projectId, kind: "task", title, dueDate }, "web");

    const tz = "Europe/London";
    const now = Date.UTC(2026, 10, 14, 12); // midday on the 14th in London
    add(work.id, "work today", "2026-11-14");
    add(home.id, "home today", "2026-11-14");
    add(home.id, "overdue", "2026-11-10");
    add(home.id, "tomorrow", "2026-11-15");
    add(home.id, "no date", null);
    add(paused.id, "paused list", "2026-11-14");
    add(archived.id, "archived list", "2026-11-14");
    const doneOld = add(home.id, "done before today", "2026-11-12");
    const doneNow = add(home.id, "done today", "2026-11-13");
    db.update(items).set({ completedAt: Date.UTC(2026, 10, 13, 9) }).where(eq(items.id, doneOld.id)).run();
    db.update(items).set({ completedAt: Date.UTC(2026, 10, 14, 9) }).where(eq(items.id, doneNow.id)).run();

    const r = listToday(db, userId, { timeZone: tz, now });
    expect(r.today).toBe("2026-11-14");
    expect(r.items.map((i) => i.title)).toEqual([
      "overdue",
      "done today",
      "home today",
      "work today",
    ]);
    // UTC+14: just after 4am on the 14th there is still the 13th in UTC.
    const kiritimati = add(home.id, "done at dawn in Kiritimati", "2026-11-14");
    db.update(items)
      .set({ completedAt: Date.UTC(2026, 10, 13, 14, 30) })
      .where(eq(items.id, kiritimati.id))
      .run();
    expect(
      listToday(db, userId, { timeZone: "Pacific/Kiritimati", today: "2026-11-14" }).items.map(
        (i) => i.title,
      ),
    ).toContain("done at dawn in Kiritimati");
    // At 2am on the 15th it's still the 14th.
    expect(listToday(db, userId, { timeZone: tz, now: Date.UTC(2026, 10, 15, 2) }).today).toBe(
      "2026-11-14",
    );
  });

  it("lists No date across active lists: undated tasks by list, dated parents' checklists left out", () => {
    const { db } = createTestDb();
    const userId = createTestUser(db);
    const home = createProject(db, userId, { name: "Home" }, "web");
    const buy = createProject(db, userId, { name: "Buy" }, "web");
    const empty = createProject(db, userId, { name: "All dated" }, "web");
    const paused = createProject(db, userId, { name: "Later" }, "web");
    updateProject(db, userId, paused.id, { status: "paused" }, "web");
    const archived = createProject(db, userId, { name: "Old" }, "web");
    updateProject(db, userId, archived.id, { status: "archived" }, "web");
    // Board order, not creation order: Buy moves to the front.
    reorderProject(db, userId, buy.id, "start", "web");
    const add = (
      projectId: string,
      title: string,
      dueDate: string | null,
      more: { parentId?: string; kind?: "task" | "milestone" } = {},
    ) =>
      addItem(
        db,
        userId,
        { projectId, kind: more.kind ?? "task", title, dueDate, parentId: more.parentId },
        "web",
      );

    const tz = "Europe/London";
    const now = Date.UTC(2026, 10, 14, 12);
    add(buy.id, "slippers", null);
    add(home.id, "tiling", null);
    add(home.id, "bins", "2026-11-14");
    add(home.id, "v1", null, { kind: "milestone" });
    const tidy = add(home.id, "tidy flat", null);
    add(home.id, "lounge", null, { parentId: tidy.id });
    add(home.id, "kitchen", "2026-11-20", { parentId: tidy.id });
    const plan = add(home.id, "phone plan", "2026-11-18");
    add(home.id, "fred's sim", null, { parentId: plan.id });
    add(empty.id, "dated", "2026-11-15");
    add(paused.id, "paused undated", null);
    add(archived.id, "archived undated", null);
    const doneOld = add(home.id, "done yesterday", null);
    const doneNow = add(home.id, "done today", null);
    db.update(items).set({ completedAt: Date.UTC(2026, 10, 13, 9) }).where(eq(items.id, doneOld.id)).run();
    db.update(items).set({ completedAt: Date.UTC(2026, 10, 14, 9) }).where(eq(items.id, doneNow.id)).run();

    const r = listNoDate(db, userId, { timeZone: tz, now });
    expect(r.today).toBe("2026-11-14");
    // Board order (Buy before Home), list order within; lists with nothing
    // undated, paused lists and archived lists go.
    expect(r.lists.map((l) => [l.project.name, l.items.map((i) => i.title)])).toEqual([
      ["Buy", ["slippers"]],
      ["Home", ["tiling", "tidy flat", "lounge", "done today"]],
    ]);
  });
});
