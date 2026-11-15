import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listAudit } from "./audit";
import {
  addItem,
  completeItem,
  deleteItem,
  getItem,
  listItems,
  reopenDueRepeats,
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
import { setTimeZone } from "./users";
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
    addItem(db, userId, { projectId, title: "first" }, "web");
    addItem(db, userId, { projectId, title: "second" }, "web");
    expect(listItems(db, userId, projectId).map((i) => i.title)).toEqual([
      "first",
      "second",
    ]);
  });

  it("honours positionRef: 'top'", () => {
    const { db, userId, projectId } = seedProject();
    addItem(db, userId, { projectId, title: "first" }, "web");
    addItem(
      db,
      userId,
      { projectId, title: "above", positionRef: "top" },
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
      addItem(db, userId, { projectId, title }, "web");
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
      { projectId, title: "done" },
      "web",
    );
    const open = addItem(
      db,
      userId,
      { projectId, title: "open" },
      "web",
    );
    completeItem(db, userId, done.id, "web");
    addItem(
      db,
      userId,
      { projectId, title: "new", positionRef: "top" },
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
      addItem(db, userId, { projectId, title }, "web");
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
      { projectId, title: "with cat", category: "infra" },
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
      { projectId, title: "toggle" },
      "web",
    );
    completeItem(db, userId, item.id, "mcp");
    uncompleteItem(db, userId, item.id, "web");
    const actions = listAudit(db, userId, { projectId })
      .filter((e) => e.entityId === item.id)
      .map((e) => e.action);
    expect(actions).toEqual(["uncomplete", "complete", "create"]);
  });

  it("creates an item already completed, logging the create and the complete", () => {
    const { db, userId, projectId } = seedProject();
    const open = addItem(db, userId, { projectId, title: "open" }, "web");
    const done = addItem(
      db,
      userId,
      { projectId, title: "done", completed: true },
      "mcp",
    );
    expect(done.completedAt).not.toBeNull();
    expect(open.completedAt).toBeNull();
    expect(listItems(db, userId, projectId).map((i) => i.title)).toEqual(["open"]);
    const rows = listAudit(db, userId, { projectId }).filter(
      (e) => e.entityId === done.id,
    );
    expect(rows.map((e) => [e.action, e.source]).sort()).toEqual([
      ["complete", "mcp"],
      ["create", "mcp"],
    ]);
    // completed: false is the default, not a completion.
    const no = addItem(
      db,
      userId,
      { projectId, title: "no", completed: false },
      "web",
    );
    expect(no.completedAt).toBeNull();
    expect(
      listAudit(db, userId, { projectId }).filter((e) => e.entityId === no.id)
        .map((e) => e.action),
    ).toEqual(["create"]);
  });

  it("skips audit on no-op updates", () => {
    const { db, userId, projectId } = seedProject();
    const item = addItem(
      db,
      userId,
      { projectId, title: "same" },
      "web",
    );
    const before = listAudit(db, userId).length;
    updateItem(db, userId, item.id, { title: "same" }, "web");
    expect(listAudit(db, userId).length).toBe(before);
  });

  it("rejects a blank title on create", () => {
    const { db, userId, projectId } = seedProject();
    expect(() =>
      addItem(db, userId, { projectId, title: "   " }, "web"),
    ).toThrow(/title cannot be empty/);
  });

  it("rejects clearing the title on update and leaves it unchanged", () => {
    const { db, userId, projectId } = seedProject();
    const item = addItem(
      db,
      userId,
      { projectId, title: "keep me" },
      "web",
    );
    expect(() =>
      updateItem(db, userId, item.id, { title: "  " }, "web"),
    ).toThrow(/title cannot be empty/);
    expect(getItem(db, userId, item.id)?.title).toBe("keep me");
  });

  it("reorders to end", () => {
    const { db, userId, projectId } = seedProject();
    const a = addItem(db, userId, { projectId, title: "a" }, "web");
    addItem(db, userId, { projectId, title: "b" }, "web");
    reorderItem(db, userId, a.id, "end", "web");
    expect(listItems(db, userId, projectId).map((i) => i.title)).toEqual([
      "b",
      "a",
    ]);
  });

  it("places next to a middle item, and rejects unknown anchors and bad refs", () => {
    const { db, userId, projectId } = seedProject();
    const add = (title: string) =>
      addItem(db, userId, { projectId, title }, "web");
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
    addItem(db, userId, { projectId, title: "real" }, "web");
    // An empty id must not fall through to "match any owned item".
    expect(getItem(db, userId, "")).toBeUndefined();
    expect(getItem(db, userId, "nope")).toBeUndefined();
  });

  it("numbers items monotonically per project, never reusing after delete", () => {
    const { db, userId, projectId } = seedProject();
    const a = addItem(db, userId, { projectId, title: "a" }, "web");
    const b = addItem(db, userId, { projectId, title: "b" }, "web");
    expect([a.number, b.number]).toEqual([1, 2]);

    // Deleting b must not hand its number back to the next item.
    deleteItem(db, userId, b.id, "web");
    const c = addItem(db, userId, { projectId, title: "c" }, "web");
    expect(c.number).toBe(3);
  });

  it("numbers each project independently", () => {
    const { db, userId, projectId } = seedProject();
    const other = createProject(db, userId, { name: "Other" }, "web");
    const a = addItem(db, userId, { projectId, title: "a" }, "web");
    const b = addItem(
      db,
      userId,
      { projectId: other.id, title: "b" },
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
      { projectId, title: "rm" },
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
      { projectId, title: "do it" },
      "web",
    );
    return { db, owner, alice, bob, projectId, item };
  }

  const ids = (db: Parameters<typeof getItem>[0], userId: string, id: string) =>
    getItem(db, userId, id)?.assigneeIds;
  // Every audit detail for the item. listAudit orders by time alone, so rows
  // written in the same millisecond can come back in either order.
  const details = (db: Parameters<typeof listAudit>[0], userId: string, id: string) =>
    listAudit(db, userId)
      .filter((e) => e.entityId === id)
      .map((e) => e.detail);

  it("is unassigned by default", () => {
    const { item } = seedShared();
    expect(item.assigneeIds).toEqual([]);
  });

  it("assigns several people at once and names each in the audit row", () => {
    const { db, owner, alice, item } = seedShared();
    const updated = updateItem(db, owner, item.id, { assigneeIds: [owner, alice] }, "web");
    expect(updated.assigneeIds).toEqual([owner, alice]);
    const row = listAudit(db, owner).find(
      (e) => e.entityId === item.id && e.action === "update",
    );
    expect(row?.detail).toBe("do it: assigned @owner, @alice");
  });

  it("assigns several people on create, and rejects anyone without access before creating", () => {
    const { db, owner, alice, bob, projectId } = seedShared();
    const created = addItem(
      db,
      owner,
      { projectId, title: "for us", assigneeIds: [owner, alice] },
      "web",
    );
    expect(created.assigneeIds).toEqual([owner, alice]);
    expect(
      listAudit(db, owner).find((e) => e.entityId === created.id)?.detail,
    ).toContain("assigned to @owner, @alice");

    const before = listItems(db, owner, projectId).length;
    expect(() =>
      addItem(
        db,
        owner,
        { projectId, title: "for bob", assigneeIds: [alice, bob] },
        "web",
      ),
    ).toThrow(/does not have access/);
    expect(listItems(db, owner, projectId)).toHaveLength(before);
    // The failed create didn't use up an item number.
    expect(
      addItem(db, owner, { projectId, title: "next" }, "web").number,
    ).toBe(created.number + 1);
  });

  it("audits who was added and who was removed when the set changes", () => {
    const { db, owner, alice, item } = seedShared();
    updateItem(db, owner, item.id, { assigneeIds: [owner] }, "web");
    updateItem(db, owner, item.id, { assigneeIds: [alice] }, "web");
    expect(ids(db, owner, item.id)).toEqual([alice]);
    expect(details(db, owner, item.id)).toContain(
      "do it: assigned @alice, unassigned @owner",
    );
  });

  it("unassigns everyone with [] and names who was taken off", () => {
    const { db, owner, alice, item } = seedShared();
    updateItem(db, owner, item.id, { assigneeIds: [owner, alice] }, "web");
    const cleared = updateItem(db, owner, item.id, { assigneeIds: [] }, "web");
    expect(cleared.assigneeIds).toEqual([]);
    expect(details(db, owner, item.id)).toContain("do it: unassigned @owner, @alice");
  });

  it("drops duplicate ids", () => {
    const { db, owner, alice, item } = seedShared();
    updateItem(db, owner, item.id, { assigneeIds: [alice, alice] }, "web");
    expect(ids(db, owner, item.id)).toEqual([alice]);
  });

  it("applies adds and removes to the current set, keeping others' changes", () => {
    const { db, owner, alice, item } = seedShared();
    // Two screens that both still show the item unassigned: one adds alice,
    // the other then adds the owner. Neither change undoes the other.
    updateItem(db, alice, item.id, { addAssigneeIds: [alice] }, "web");
    updateItem(db, owner, item.id, { addAssigneeIds: [owner] }, "web");
    expect(ids(db, owner, item.id)).toEqual([alice, owner]);
    expect(details(db, owner, item.id)).toContain("do it: assigned @owner");

    updateItem(db, owner, item.id, { removeAssigneeIds: [owner] }, "web");
    expect(ids(db, owner, item.id)).toEqual([alice]);
    expect(details(db, owner, item.id)).toContain("do it: unassigned @owner");
  });

  it("rejects the whole change when anyone in it lacks list access", () => {
    const { db, owner, alice, bob, item } = seedShared();
    updateItem(db, owner, item.id, { assigneeIds: [owner] }, "web");
    expect(() =>
      updateItem(db, owner, item.id, { assigneeIds: [alice, bob] }, "web"),
    ).toThrow(/does not have access/);
    expect(ids(db, owner, item.id)).toEqual([owner]);
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
      { projectId, title: "x" },
      "web",
    );
    expect(() =>
      updateItem(db, owner, item.id, { assigneeIds: [carol] }, "web"),
    ).toThrow(/does not have access/);
  });

  it("treats the same people in another order as a no-op (no audit row)", () => {
    const { db, owner, alice, item } = seedShared();
    updateItem(db, owner, item.id, { assigneeIds: [owner, alice] }, "web");
    const count = () =>
      listAudit(db, owner).filter((e) => e.entityId === item.id).length;
    const before = count();
    updateItem(db, owner, item.id, { assigneeIds: [alice, owner] }, "web");
    expect(count()).toBe(before);
    expect(ids(db, owner, item.id)).toEqual([owner, alice]);
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
      updateItem(db, alice, item.id, { assigneeIds: [owner] }, "web").assigneeIds,
    ).toEqual([owner]);
  });
});

describe("checklists (sub-items)", () => {
  function setup() {
    const { db, userId, projectId } = seedProject();
    const add = (
      title: string,
      opts: { parentId?: string; positionRef?: string; subItems?: string[] } = {},
    ) => addItem(db, userId, { projectId, title, ...opts }, "web");
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

  it("creates an item's sub-items with it, in order and logged, or none at all", () => {
    const { db, userId, projectId, add, tree } = setup();
    add("a");
    const p = add("tidy", { subItems: ["lounge", "kitchen"] });
    const created = () =>
      listAudit(db, userId, { projectId })
        .filter((e) => e.action === "create" && e.entityType === "item")
        .map((e) => e.detail)
        .reverse();
    const logged = [
      'added task "a"',
      'added task "tidy"',
      'added "lounge" to "tidy"',
      'added "kitchen" to "tidy"',
    ];
    expect(tree()).toEqual([
      ["a", []],
      ["tidy", ["lounge", "kitchen"]],
    ]);
    expect(created()).toEqual(logged);

    // A sub-item can't have its own, and a bad title adds nothing.
    expect(() => add("hall", { parentId: p.id, subItems: ["rug"] })).toThrow(
      "already a sub-item",
    );
    expect(() => add("garden", { subItems: ["weed", "  "] })).toThrow(
      "item title cannot be empty",
    );
    expect(tree()).toEqual([
      ["a", []],
      ["tidy", ["lounge", "kitchen"]],
    ]);
    expect(created()).toEqual(logged);
  });

  it("creates a done item's sub-items done, each logged, leaving it done", () => {
    const { db, userId, projectId } = setup();
    addItem(
      db,
      userId,
      { projectId, title: "tidy", completed: true, subItems: ["lounge", "kitchen"] },
      "web",
    );
    const all = listItems(db, userId, projectId, { includeCompleted: true });
    expect(Object.fromEntries(all.map((i) => [i.title, i.completedAt !== null]))).toEqual({
      tidy: true,
      lounge: true,
      kitchen: true,
    });
    expect(
      listAudit(db, userId, { projectId })
        .filter((e) => e.entityType === "item" && e.action !== "create")
        .map((e) => e.detail)
        .reverse(),
    ).toEqual(['completed "tidy"', 'completed "lounge"', 'completed "kitchen"']);
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

  it("ticking a parent's last open sub-item completes the parent, audited", () => {
    const { db, userId, projectId, add } = setup();
    const p = add("tidy");
    const lounge = add("lounge", { parentId: p.id });
    const kitchen = add("kitchen", { parentId: p.id });
    const other = add("other");
    add("other step", { parentId: other.id });

    completeItem(db, userId, lounge.id, "web");
    expect(getItem(db, userId, p.id)?.completedAt).toBeNull();
    completeItem(db, userId, kitchen.id, "mcp");
    expect(getItem(db, userId, p.id)?.completedAt).not.toBeNull();
    expect(getItem(db, userId, other.id)?.completedAt).toBeNull();
    expect(listAudit(db, userId, { projectId })[0]).toMatchObject({
      action: "complete",
      entityId: p.id,
      source: "mcp",
    });

    // Reopening a sub-item reopens the parent; ticking it again closes it again.
    uncompleteItem(db, userId, kitchen.id, "web");
    expect(getItem(db, userId, p.id)?.completedAt).toBeNull();
    completeItem(db, userId, kitchen.id, "web");
    expect(getItem(db, userId, p.id)?.completedAt).not.toBeNull();
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

  it("adding an already-done sub-item leaves a finished parent finished", () => {
    const { db, userId, projectId } = setup();
    const p = addItem(db, userId, { projectId, title: "tidy" }, "web");
    completeItem(db, userId, p.id, "web");
    addItem(
      db,
      userId,
      { projectId, title: "lounge", parentId: p.id, completed: true },
      "web",
    );
    expect(getItem(db, userId, p.id)?.completedAt).not.toBeNull();
  });

  it("reopening a parent leaves its sub-items ticked", () => {
    const { db, userId, add } = setup();
    const p = add("tidy");
    const c = add("lounge", { parentId: p.id });
    completeItem(db, userId, p.id, "web");
    uncompleteItem(db, userId, p.id, "web");
    expect(getItem(db, userId, c.id)?.completedAt).not.toBeNull();
  });

  it("is one level deep and within one list", () => {
    const { db, userId, add } = setup();
    const p = add("tidy");
    const c = add("lounge", { parentId: p.id });
    expect(() => add("rug", { parentId: c.id })).toThrow(/already a sub-item/);

    const other = createProject(db, userId, { name: "Other" }, "web");
    expect(() =>
      addItem(db, userId, { projectId: other.id, title: "x", parentId: p.id }, "web"),
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
      { projectId, title: "bins", dueDate: "2026-11-14" },
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
      addItem(db, userId, { projectId, title: "x", dueDate: "14/11" }, "web"),
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
      addItem(db, userId, { projectId, title, dueDate }, "web");

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
      more: { parentId?: string } = {},
    ) =>
      addItem(
        db,
        userId,
        { projectId, title, dueDate, parentId: more.parentId },
        "web",
      );

    const tz = "Europe/London";
    const now = Date.UTC(2026, 10, 14, 12);
    add(buy.id, "slippers", null);
    add(home.id, "tiling", null);
    add(home.id, "bins", "2026-11-14");
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

describe("repeating items", () => {
  afterEach(() => vi.useRealTimers());
  const tz = "Europe/London";
  // Complete at a chosen moment, through completeItem itself.
  function completeAt(db: ReturnType<typeof seedProject>["db"], userId: string, id: string, ts: number) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(ts);
    completeItem(db, userId, id, "web");
    vi.useRealTimers();
  }

  it("sets, changes and clears a rule, auditing each change and not a no-op", () => {
    const { db, userId, projectId } = seedProject();
    const it = addItem(
      db,
      userId,
      { projectId, title: "Water plants", repeat: { every: 3, unit: "day" } },
      "web",
    );
    expect([it.repeatEvery, it.repeatUnit]).toEqual([3, "day"]);
    expect(listAudit(db, userId)[0].detail).toBe('added task "Water plants", repeats every 3 days');

    const changed = updateItem(db, userId, it.id, { repeat: { every: 2, unit: "week" } }, "web");
    expect([changed.repeatEvery, changed.repeatUnit]).toEqual([2, "week"]);
    expect(listAudit(db, userId)[0].detail).toBe("Water plants: repeats every 2 weeks");

    const before = listAudit(db, userId).length;
    updateItem(db, userId, it.id, { repeat: { every: 2, unit: "week" } }, "web");
    expect(listAudit(db, userId)).toHaveLength(before);

    const cleared = updateItem(db, userId, it.id, { repeat: null }, "web");
    expect([cleared.repeatEvery, cleared.repeatUnit]).toEqual([null, null]);
    expect(listAudit(db, userId)[0].detail).toBe("Water plants: no longer repeats");
  });

  it("rejects a bad rule", () => {
    const { db, userId, projectId } = seedProject();
    const task = addItem(db, userId, { projectId, title: "t" }, "web");
    for (const repeat of [
      { every: 0, unit: "day" as const },
      { every: 1.5, unit: "day" as const },
      { every: 366, unit: "day" as const },
      { every: 1, unit: "year" as "day" },
    ]) {
      expect(() => updateItem(db, userId, task.id, { repeat }, "web")).toThrow(/repeat/);
    }
    expect(getItem(db, userId, task.id)?.repeatUnit).toBeNull();
  });

  it("reopens as the same item on the next due day, counted from the day it was done", () => {
    const { db, userId, projectId } = seedProject();
    const plants = addItem(
      db,
      userId,
      {
        projectId,
        title: "Water plants",
        dueDate: "2026-11-12",
        repeat: { every: 3, unit: "day" },
      },
      "web",
    );
    // Watered two days late, on the evening of Saturday the 14th.
    completeAt(db, userId, plants.id, Date.UTC(2026, 10, 14, 20));

    // Still crossed out for the rest of that day, and up to 3:59am on the 17th.
    for (const now of [Date.UTC(2026, 10, 14, 23), Date.UTC(2026, 10, 17, 3, 59)]) {
      expect(reopenDueRepeats(db, userId, { timeZone: tz, now })).toBe(0);
    }
    expect(getItem(db, userId, plants.id)?.completedAt).not.toBeNull();

    // 4am on the 17th, three days after it was done (not after it was due).
    expect(reopenDueRepeats(db, userId, { timeZone: tz, now: Date.UTC(2026, 10, 17, 4) })).toBe(1);
    const reopened = getItem(db, userId, plants.id);
    expect(reopened).toMatchObject({
      id: plants.id,
      number: plants.number,
      position: plants.position,
      completedAt: null,
      dueDate: "2026-11-17",
    });
    const [row] = listAudit(db, userId);
    expect(row).toMatchObject({
      source: "system",
      actor: "system",
      actorName: "Sidetrack",
      action: "uncomplete",
      entityId: plants.id,
      projectId,
      agentName: null,
    });
    expect(row.detail).toBe('reopened "Water plants" (repeats every 3 days), due 2026-11-17');

    // Looking again reopens nothing and logs nothing.
    const rows = listAudit(db, userId).length;
    expect(reopenDueRepeats(db, userId, { timeZone: tz, now: Date.UTC(2026, 10, 18, 9) })).toBe(0);
    expect(listAudit(db, userId)).toHaveLength(rows);
  });

  it("counts a completion before 4am as the day before, in the user's saved zone", () => {
    const { db, userId, projectId } = seedProject();
    setTimeZone(db, userId, "Pacific/Auckland"); // UTC+13 in November
    const salt = addItem(
      db,
      userId,
      { projectId, title: "Refill salt", repeat: { every: 1, unit: "month" } },
      "web",
    );
    // 1am on 1 December in Auckland: still 30 November there.
    completeAt(db, userId, salt.id, Date.UTC(2026, 10, 30, 12));
    // Due 30 December, from 4am Auckland time (15:00 UTC on the 29th).
    expect(reopenDueRepeats(db, userId, { now: Date.UTC(2026, 11, 29, 14, 59) })).toBe(0);
    expect(reopenDueRepeats(db, userId, { now: Date.UTC(2026, 11, 29, 15) })).toBe(1);
    expect(getItem(db, userId, salt.id)?.dueDate).toBe("2026-12-30");
  });

  it("leaves items that don't repeat, open items, and archived lists alone", () => {
    const { db, userId, projectId } = seedProject();
    const add = (projectId: string, title: string, repeat: { every: number; unit: "day" } | null) =>
      addItem(db, userId, { projectId, title, repeat }, "web");
    const once = add(projectId, "once", null);
    const open = add(projectId, "open", { every: 1, unit: "day" });
    const archived = createProject(db, userId, { name: "Old" }, "web");
    const old = add(archived.id, "in archived list", { every: 1, unit: "day" });
    completeAt(db, userId, once.id, Date.UTC(2026, 10, 1, 12));
    completeAt(db, userId, old.id, Date.UTC(2026, 10, 1, 12));
    updateProject(db, userId, archived.id, { status: "archived" }, "web");

    expect(reopenDueRepeats(db, userId, { timeZone: tz, now: Date.UTC(2026, 10, 14, 12) })).toBe(0);
    expect(getItem(db, userId, once.id)?.completedAt).not.toBeNull();
    expect(getItem(db, userId, old.id)?.completedAt).not.toBeNull();
    expect(getItem(db, userId, open.id)).toMatchObject({ completedAt: null, dueDate: null });
  });

  it("brings the checklist round with its parent", () => {
    const { db, userId, projectId } = seedProject();
    const tidy = addItem(
      db,
      userId,
      { projectId, title: "Tidy flat", repeat: { every: 1, unit: "week" } },
      "web",
    );
    const kitchen = addItem(
      db,
      userId,
      { projectId, title: "Kitchen", parentId: tidy.id },
      "web",
    );
    completeAt(db, userId, tidy.id, Date.UTC(2026, 10, 14, 12));
    expect(getItem(db, userId, kitchen.id)?.completedAt).not.toBeNull();

    reopenDueRepeats(db, userId, { timeZone: tz, now: Date.UTC(2026, 10, 21, 12) });
    expect(getItem(db, userId, tidy.id)).toMatchObject({ completedAt: null, dueDate: "2026-11-21" });
    expect(getItem(db, userId, kitchen.id)?.completedAt).toBeNull();
    expect(
      listAudit(db, userId).filter((r) => r.source === "system").map((r) => r.entityId),
    ).toEqual(expect.arrayContaining([tidy.id, kitchen.id]));
  });

  it("keeps a repeating sub-item waiting for its finished repeating parent", () => {
    const { db, userId, projectId } = seedProject();
    const tidy = addItem(
      db,
      userId,
      {
        projectId,
        title: "Tidy flat",
        dueDate: "2026-11-14",
        repeat: { every: 1, unit: "week" },
      },
      "web",
    );
    const bins = addItem(
      db,
      userId,
      { projectId, title: "Bins", parentId: tidy.id, repeat: { every: 1, unit: "day" } },
      "web",
    );
    completeAt(db, userId, tidy.id, Date.UTC(2026, 10, 14, 12));
    // The sub-item's own day comes first, but the parent isn't due until the 21st.
    expect(reopenDueRepeats(db, userId, { timeZone: tz, now: Date.UTC(2026, 10, 16, 12) })).toBe(0);
    expect(getItem(db, userId, tidy.id)).toMatchObject({ dueDate: "2026-11-14" });
    expect(getItem(db, userId, tidy.id)?.completedAt).not.toBeNull();
    expect(getItem(db, userId, bins.id)?.completedAt).not.toBeNull();
    // On the parent's day, both come round.
    reopenDueRepeats(db, userId, { timeZone: tz, now: Date.UTC(2026, 10, 21, 12) });
    expect(getItem(db, userId, tidy.id)).toMatchObject({ completedAt: null, dueDate: "2026-11-21" });
    expect(getItem(db, userId, bins.id)).toMatchObject({ completedAt: null, dueDate: "2026-11-21" });
  });

  it("reopens a parent that doesn't repeat when its repeating sub-item comes due", () => {
    const { db, userId, projectId } = seedProject();
    const plan = addItem(db, userId, { projectId, title: "Plan" }, "web");
    const step = addItem(
      db,
      userId,
      { projectId, title: "Step", parentId: plan.id, repeat: { every: 1, unit: "day" } },
      "web",
    );
    completeAt(db, userId, plan.id, Date.UTC(2026, 10, 14, 12));
    reopenDueRepeats(db, userId, { timeZone: tz, now: Date.UTC(2026, 10, 15, 12) });
    expect(getItem(db, userId, step.id)).toMatchObject({ completedAt: null, dueDate: "2026-11-15" });
    expect(getItem(db, userId, plan.id)?.completedAt).toBeNull();
  });

  it("only reopens items the user can see", () => {
    const { db, userId, projectId } = seedProject();
    const other = createTestUser(db);
    const it = addItem(
      db,
      userId,
      { projectId, title: "mine", repeat: { every: 1, unit: "day" } },
      "web",
    );
    completeAt(db, userId, it.id, Date.UTC(2026, 10, 1, 12));
    expect(reopenDueRepeats(db, other, { timeZone: tz, now: Date.UTC(2026, 10, 14, 12) })).toBe(0);
    expect(getItem(db, userId, it.id)?.completedAt).not.toBeNull();
  });
});
