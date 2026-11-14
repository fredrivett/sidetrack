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
  uncompleteItem,
  updateItem,
} from "./items";
import { acceptInvite, inviteMember, listAssignees } from "./members";
import { createProject } from "./projects";
import { items } from "./schema";
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
