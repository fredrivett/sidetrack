import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listAudit } from "./audit";
import { changeSeq } from "./changes";
import { addLabel, listLabels } from "./labels";
import {
  addItem,
  addParentItem,
  cancelItem,
  completeItem,
  deleteItem,
  getItem,
  listDoneBefore,
  listItems,
  readItems,
  reopenDueRepeats,
  reorderItem,
  setItemOrder,
  setItemParent,
  setItemsCollapsed,
  sortItems,
  uncompleteItem,
  updateItem,
} from "./items";
import { acceptInvite, inviteMember, listAssignees } from "./members";
import {
  createProject,
  getProject,
  listNoDate,
  listToday,
  reorderProject,
  updateProject,
} from "./projects";
import { items } from "./schema";
import { setSmartRule } from "./smartDue";
import { setTimeZone } from "./users";
import { nestItems } from "../lib/itemTree";
import type { Repeat } from "../lib/repeat";
import { createTestDb, createTestUser } from "./test-helpers";

function seedProject() {
  const { db } = createTestDb();
  const userId = createTestUser(db);
  const p = createProject(db, userId, { name: "P" }, "web");
  return { db, userId, projectId: p.id };
}

describe("items", () => {
  it("puts a new item first by default, and a new sub-item last", () => {
    const { db, userId, projectId } = seedProject();
    const first = addItem(db, userId, { projectId, title: "first" }, "web");
    addItem(db, userId, { projectId, title: "second" }, "web");
    addItem(db, userId, { projectId, title: "step 1", parentId: first.id }, "web");
    addItem(db, userId, { projectId, title: "step 2", parentId: first.id }, "web");
    const all = listItems(db, userId, projectId);
    expect(all.filter((i) => !i.parentId).map((i) => i.title)).toEqual(["second", "first"]);
    expect(all.filter((i) => i.parentId === first.id).map((i) => i.title)).toEqual([
      "step 1",
      "step 2",
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
      addItem(db, userId, { projectId, title, positionRef: "end" }, "web");
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
      addItem(db, userId, { projectId, title, positionRef: "end" }, "web");
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

  it("auto-creates inline labels with their emoji, without auditing them", () => {
    const { db, userId, projectId } = seedProject();
    addLabel(db, userId, projectId, { name: "bug", emoji: "🐛" }, "web");
    const item = addItem(
      db,
      userId,
      {
        projectId,
        title: "with labels",
        labels: [" infra ", "bug", "infra", ""],
        labelEmoji: { infra: { emoji: "⚙️", chosen: false }, bug: { emoji: "🔥", chosen: true } },
      },
      "web",
    );
    expect(item.labels).toEqual(["infra", "bug"]);
    const byName = Object.fromEntries(listLabels(db, userId, projectId).map((l) => [l.name, l]));
    expect(byName.infra).toMatchObject({ emoji: "⚙️", emojiChosen: false });
    // An existing label keeps its emoji: labelEmoji is only for new ones.
    expect(byName.bug).toMatchObject({ emoji: "🐛", emojiChosen: true });
    const log = listAudit(db, userId);
    expect(log.find((e) => e.entityId === item.id)).toMatchObject({
      action: "create",
      detail: 'added task "with labels", labelled infra, bug',
    });
    // ensureLabels is intentionally NOT audited — the parent create is the
    // logged event (the one label row is addLabel's).
    expect(log.filter((e) => e.entityType === "label")).toHaveLength(1);
  });

  it("replaces an item's labels, logging what was added and taken off", () => {
    const { db, userId, projectId } = seedProject();
    const item = addItem(db, userId, { projectId, title: "t", labels: ["a", "b"] }, "web");
    // The same labels in another order change nothing.
    updateItem(db, userId, item.id, { labels: ["b", "a"] }, "web");
    const updated = updateItem(db, userId, item.id, { labels: ["b", "c"] }, "web");
    expect(updated.labels).toEqual(["b", "c"]);
    const updates = listAudit(db, userId).filter(
      (e) => e.entityId === item.id && e.action === "update",
    );
    expect(updates.map((e) => e.detail)).toEqual(["updated t: labelled c, unlabelled a"]);
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
      addItem(db, userId, { projectId, title, positionRef: "end" }, "web");
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

  it("reads rows back for the board, with what can't be read as gone", () => {
    const { db, userId, projectId } = seedProject();
    const mine = addItem(db, userId, { projectId, title: "mine" }, "web");
    const deleted = addItem(db, userId, { projectId, title: "deleted" }, "web");
    deleteItem(db, userId, deleted.id, "web");
    const stranger = createTestUser(db);
    const theirs = addItem(
      db,
      stranger,
      { projectId: createProject(db, stranger, { name: "Theirs" }, "web").id, title: "theirs" },
      "web",
    );
    const before = changeSeq();
    const saved = readItems(db, userId, [mine.id, theirs.id, mine.id, deleted.id]);
    expect(saved.seq).toBeGreaterThanOrEqual(before);
    expect(saved.items.map((i) => i.title)).toEqual(["mine"]);
    expect(saved.gone).toEqual([theirs.id, deleted.id]);
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
    expect(row?.detail).toBe("updated do it: assigned @owner, @alice");
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
      "updated do it: assigned @alice, unassigned @owner",
    );
  });

  it("unassigns everyone with [] and names who was taken off", () => {
    const { db, owner, alice, item } = seedShared();
    updateItem(db, owner, item.id, { assigneeIds: [owner, alice] }, "web");
    const cleared = updateItem(db, owner, item.id, { assigneeIds: [] }, "web");
    expect(cleared.assigneeIds).toEqual([]);
    expect(details(db, owner, item.id)).toContain("updated do it: unassigned @owner, @alice");
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
    expect(details(db, owner, item.id)).toContain("updated do it: assigned @owner");

    updateItem(db, owner, item.id, { removeAssigneeIds: [owner] }, "web");
    expect(ids(db, owner, item.id)).toEqual([alice]);
    expect(details(db, owner, item.id)).toContain("updated do it: unassigned @owner");
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
      opts: { parentId?: string; positionRef?: string; subItems?: string[]; completed?: boolean } = {},
    ) => addItem(db, userId, { projectId, title, positionRef: "end", ...opts }, "web");
    const tree = () =>
      nestItems(listItems(db, userId, projectId, { includeCompleted: true })).map(
        (i) => [i.title, i.children.map((c) => c.title)],
      );
    return { db, userId, projectId, add, tree };
  }

  it("completedSince keeps a group while any of it is open or finished since", () => {
    const { db, userId, projectId, add } = setup();
    const cutoff = Date.UTC(2026, 10, 8);
    const completeAt = (id: string, ts: number) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(ts);
      completeItem(db, userId, id, "web");
      vi.useRealTimers();
    };
    const before = cutoff - 60_000;
    const after = cutoff + 60_000;
    add("Open");
    completeAt(add("Old").id, before);
    completeAt(add("Recent").id, cutoff);
    // An open parent keeps a sub-item finished long ago.
    const trip = add("Trip", { subItems: ["Book", "Pack bags"] });
    const [book] = listItems(db, userId, projectId).filter((i) => i.parentId === trip.id);
    completeAt(book.id, before);
    // A parent finished recently keeps a sub-item finished before it.
    const move = add("Move", { subItems: ["Pack boxes", "Clean"] });
    const [boxes] = listItems(db, userId, projectId).filter((i) => i.parentId === move.id);
    completeAt(boxes.id, before);
    completeAt(move.id, after);
    // A parent finished long ago goes, sub-items and all.
    completeAt(add("Archive", { subItems: ["Scan"] }).id, before);
    // Unless a sub-item was added to it, already finished, since.
    const late = add("Late");
    completeAt(late.id, before);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(after);
    add("Late extra", { parentId: late.id, completed: true });
    vi.useRealTimers();

    const tree = nestItems(
      listItems(db, userId, projectId, { includeCompleted: true, completedSince: cutoff }),
    ).map((i) => [i.title, i.children.map((c) => c.title)]);
    expect(tree).toEqual([
      ["Open", []],
      ["Recent", []],
      ["Trip", ["Book", "Pack bags"]],
      ["Move", ["Pack boxes", "Clean"]],
      ["Late", ["Late extra"]],
    ]);
  });

  it("listDoneBefore pages older finished items, newest first, with whole checklists", () => {
    const { db, userId, projectId, add } = setup();
    const completeAt = (id: string, ts: number) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(ts);
      completeItem(db, userId, id, "web");
      vi.useRealTimers();
    };
    const day = (d: number) => Date.UTC(2026, 9, d, 12);
    const before = day(20);
    add("Still open");
    completeAt(add("On the cut").id, before);
    completeAt(add("Laundry").id, day(18));
    // Its sub-item was finished days earlier than the parent.
    const trip = add("Trip", { subItems: ["Book trains", "Pack"] });
    const [trains] = listItems(db, userId, projectId).filter((i) => i.parentId === trip.id);
    completeAt(trains.id, day(10));
    completeAt(trip.id, day(15));
    completeAt(add("Tax return").id, day(12));
    const archived = createProject(db, userId, { name: "Old" }, "web");
    completeAt(addItem(db, userId, { projectId: archived.id, title: "Archived trip" }, "web").id, day(17));
    updateProject(db, userId, archived.id, { status: "archived" }, "web");

    const titles = (r: { items: { title: string }[] }) => r.items.map((i) => i.title);
    // The 2nd newest is "Pack" or "Trip", closed together: both come, and
    // "Book trains" comes for the checklist though it's older than `since`.
    const first = listDoneBefore(db, userId, { before, limit: 2 });
    expect(titles(first)[0]).toBe("Laundry");
    expect(titles(first).slice(1, 3).sort()).toEqual(["Pack", "Trip"]);
    expect(titles(first).slice(3)).toEqual(["Book trains"]);
    expect(first.since).toBe(day(15));
    expect(first.more).toBe(true);

    const all = listDoneBefore(db, userId, { before, limit: 10 });
    expect(titles(all).slice(0, 1)).toEqual(["Laundry"]);
    expect(titles(all).slice(3)).toEqual(["Tax return", "Book trains"]);
    expect(all.since).toBe(0);
    expect(all.more).toBe(false);

    // A match brings its parent and the rest of its checklist.
    const search = listDoneBefore(db, userId, { before, limit: 10, query: " TRAIN" });
    expect(titles(search)[0]).toBe("Book trains");
    expect(titles(search).slice(1).sort()).toEqual(["Pack", "Trip"]);
    // So does its ref, bare or qualified, in any case.
    const prefix = getProject(db, userId, projectId)?.prefix ?? "";
    for (const ref of [`${prefix}-${trains.number}`, `fred/${prefix.toLowerCase()}-${trains.number}`]) {
      expect(titles(listDoneBefore(db, userId, { before, limit: 10, query: ref }))[0]).toBe(
        "Book trains",
      );
    }
  });

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

  it("creates the lines ticked before adding done, logged, leaving the item open", () => {
    const { db, userId, projectId } = setup();
    addItem(
      db,
      userId,
      {
        projectId,
        title: "tidy",
        subItems: [{ title: "lounge", completed: true }, "kitchen", { title: "hall", completed: true }],
      },
      "web",
    );
    const all = listItems(db, userId, projectId, { includeCompleted: true });
    expect(Object.fromEntries(all.map((i) => [i.title, i.completedAt !== null]))).toEqual({
      tidy: false,
      lounge: true,
      kitchen: false,
      hall: true,
    });
    expect(
      listAudit(db, userId, { projectId })
        .filter((e) => e.entityType === "item" && e.action !== "create")
        .map((e) => e.detail)
        .reverse(),
    ).toEqual(['completed "lounge"', 'completed "hall"']);

    // Every line ticked still adds the item open.
    addItem(
      db,
      userId,
      { projectId, title: "shop", subItems: [{ title: "milk", completed: true }] },
      "web",
    );
    const shop = listItems(db, userId, projectId, { includeCompleted: true }).find(
      (i) => i.title === "shop",
    );
    expect(shop?.completedAt).toBeNull();
  });

  it("creates each line with its own fields, not the item's, and its new labels", () => {
    const { db, userId, projectId } = setup();
    addItem(
      db,
      userId,
      {
        projectId,
        title: "Trip",
        dueDate: "2026-12-01",
        labels: ["travel"],
        labelEmoji: { packing: { emoji: "🎒", chosen: true } },
        subItems: [
          {
            title: "Book trains",
            description: "Off-peak",
            dueDate: "2026-11-27",
            assigneeIds: [userId],
            repeat: { every: 1, unit: "week" },
            labels: ["packing"],
          },
          "Pack",
        ],
      },
      "web",
    );
    const all = listItems(db, userId, projectId, { includeCompleted: true });
    const by = (title: string) => all.find((i) => i.title === title);
    expect(by("Book trains")).toMatchObject({
      description: "Off-peak",
      dueDate: "2026-11-27",
      assigneeIds: [userId],
      repeatEvery: 1,
      repeatUnit: "week",
      labels: ["packing"],
      parentId: by("Trip")?.id,
    });
    // A line set nothing on gets nothing, not the item's.
    expect(by("Pack")).toMatchObject({ dueDate: null, labels: [], assigneeIds: [] });
    expect(listLabels(db, userId, projectId).find((l) => l.name === "packing")?.emoji).toBe("🎒");
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

  it("adds a parent in an item's place, with the item as its first sub-item", () => {
    const { db, userId, projectId, add, tree } = setup();
    add("a");
    const b = add("b");
    add("c");

    const trip = addParentItem(db, userId, b.id, "Trip", "web");
    expect(tree()).toEqual([
      ["a", []],
      ["Trip", ["b"]],
      ["c", []],
    ]);
    expect(trip.parentId).toBeNull();
    // Logged as the add, then the nesting.
    expect(listAudit(db, userId, { projectId }).slice(0, 2).map((r) => r.action)).toEqual([
      "update",
      "create",
    ]);

    // A sub-item can't have one, nor can an item with sub-items, and nothing is added.
    const count = () => listItems(db, userId, projectId).length;
    const before = count();
    expect(() => addParentItem(db, userId, b.id, "x", "web")).toThrow(/already a sub-item/);
    expect(() => addParentItem(db, userId, trip.id, "x", "web")).toThrow(/has sub-items/);
    expect(count()).toBe(before);
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

  it("stores collapsed on each item, without logging it", () => {
    const { db, userId, projectId, add } = setup();
    const a = add("Trip", { subItems: ["Book"] });
    const b = add("Move", { subItems: ["Pack"] });
    const collapsed = () =>
      [a.id, b.id].map((id) => getItem(db, userId, id)?.collapsed);
    const logged = listAudit(db, userId, { projectId }).length;
    expect(collapsed()).toEqual([false, false]);

    setItemsCollapsed(db, userId, [a.id], true);
    expect(collapsed()).toEqual([true, false]);
    setItemsCollapsed(db, userId, [a.id, b.id], true);
    expect(collapsed()).toEqual([true, true]);
    setItemsCollapsed(db, userId, [b.id], false);
    expect(collapsed()).toEqual([true, false]);
    // View state: none of it shows in the history.
    expect(listAudit(db, userId, { projectId })).toHaveLength(logged);

    // One unknown id fails the lot.
    expect(() =>
      setItemsCollapsed(db, userId, [b.id, "nope"], true),
    ).toThrow(/item not found/);
    expect(collapsed()).toEqual([true, false]);

    // Someone without access to the list can't change it.
    const stranger = createTestUser(db);
    expect(() => setItemsCollapsed(db, stranger, [a.id], false)).toThrow(
      /item not found/,
    );
    expect(collapsed()).toEqual([true, false]);
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
      "updated bins: due date cleared",
      "updated bins: due 2026-11-20",
    ]);
  });

  it("sets a due span, storing a one-day span as that day, and audits it", () => {
    const { db, userId, projectId } = seedProject();
    const week = { dueFrom: "2026-11-16", dueDate: "2026-11-22" };
    const it1 = addItem(db, userId, { projectId, title: "bins", ...week }, "web");
    expect(it1).toMatchObject(week);
    const audit = () =>
      listAudit(db, userId, { projectId })
        .filter((e) => e.entityId === it1.id)
        .map((e) => e.detail);
    expect(audit()).toEqual(['added task "bins", due 2026-11-16 to 2026-11-22']);

    // The same span is no change; a day alone (no dueFrom) ends the span.
    updateItem(db, userId, it1.id, week, "web");
    expect(audit()).toHaveLength(1);
    updateItem(db, userId, it1.id, { dueDate: "2026-11-22" }, "web");
    expect(getItem(db, userId, it1.id)).toMatchObject({ dueFrom: null, dueDate: "2026-11-22" });
    updateItem(db, userId, it1.id, { dueFrom: "2026-11-21", dueDate: "2026-11-21" }, "web");
    expect(getItem(db, userId, it1.id)).toMatchObject({ dueFrom: null, dueDate: "2026-11-21" });
    expect(audit()).toEqual([
      "updated bins: due 2026-11-21",
      "updated bins: due 2026-11-22",
      'added task "bins", due 2026-11-16 to 2026-11-22',
    ]);

    for (const bad of [
      { dueFrom: "2026-11-23", dueDate: "2026-11-22" },
      { dueFrom: "2026-11-22" },
      { dueFrom: "2026-11-16", dueDate: null },
      { dueFrom: "2026-02-30", dueDate: "2026-03-01" },
    ]) {
      expect(() => updateItem(db, userId, it1.id, bad, "web")).toThrow(/due/);
    }
    expect(getItem(db, userId, it1.id)).toMatchObject({ dueFrom: null, dueDate: "2026-11-21" });

    // dueFrom alone starts or ends a span on the current due date.
    updateItem(db, userId, it1.id, { dueFrom: "2026-11-16" }, "web");
    expect(getItem(db, userId, it1.id)).toMatchObject({ dueFrom: "2026-11-16", dueDate: "2026-11-21" });
    updateItem(db, userId, it1.id, { dueFrom: null }, "web");
    expect(getItem(db, userId, it1.id)).toMatchObject({ dueFrom: null, dueDate: "2026-11-21" });
    expect(audit().slice(0, 2)).toEqual(["updated bins: due 2026-11-21", "updated bins: due 2026-11-16 to 2026-11-21"]);
    const undated = addItem(db, userId, { projectId, title: "undated" }, "web");
    expect(() => updateItem(db, userId, undated.id, { dueFrom: "2026-11-16" }, "web")).toThrow(/due/);
  });

  it("lists Today across active lists: overdue first, open or done today", () => {
    const { db } = createTestDb();
    const userId = createTestUser(db);
    const home = createProject(db, userId, { name: "Home" }, "web");
    const work = createProject(db, userId, { name: "Work" }, "web");
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
    const span = (title: string, dueFrom: string, dueDate: string) =>
      addItem(db, userId, { projectId: home.id, title, dueFrom, dueDate }, "web");
    span("this week", "2026-11-09", "2026-11-15");
    span("next week", "2026-11-16", "2026-11-22");
    add(home.id, "no date", null);
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
      "this week",
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
        { projectId, title, dueDate, parentId: more.parentId, positionRef: "end" },
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
    add(archived.id, "archived undated", null);
    const doneOld = add(home.id, "done yesterday", null);
    const doneNow = add(home.id, "done today", null);
    db.update(items).set({ completedAt: Date.UTC(2026, 10, 13, 9) }).where(eq(items.id, doneOld.id)).run();
    db.update(items).set({ completedAt: Date.UTC(2026, 10, 14, 9) }).where(eq(items.id, doneNow.id)).run();

    const r = listNoDate(db, userId, { timeZone: tz, now });
    expect(r.today).toBe("2026-11-14");
    // Board order (Buy before Home), list order within; lists with nothing
    // undated and archived lists go.
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
    expect(listAudit(db, userId)[0].detail).toBe("updated Water plants: repeats every 2 weeks");

    const before = listAudit(db, userId).length;
    updateItem(db, userId, it.id, { repeat: { every: 2, unit: "week" } }, "web");
    expect(listAudit(db, userId)).toHaveLength(before);

    const cleared = updateItem(db, userId, it.id, { repeat: null }, "web");
    expect([cleared.repeatEvery, cleared.repeatUnit]).toEqual([null, null]);
    expect(listAudit(db, userId)[0].detail).toBe("updated Water plants: no longer repeats");
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

  it("brings a weekend back as one only when its rule keeps to weekends", () => {
    const { db, userId, projectId } = seedProject();
    const add = (title: string, on?: "weekend") =>
      addItem(
        db,
        userId,
        {
          projectId,
          title,
          dueFrom: "2026-11-21",
          dueDate: "2026-11-22",
          repeat: { every: 2, unit: "week", on },
        },
        "web",
      );
    const car = add("Clean the car", "weekend");
    const filter = add("Change the filter");
    // Both due this weekend, both done three days late on Wednesday the 25th.
    completeAt(db, userId, car.id, Date.UTC(2026, 10, 25, 12));
    completeAt(db, userId, filter.id, Date.UTC(2026, 10, 25, 12));

    // Two weeks on is Wednesday 9 December: the filter is due that day alone.
    expect(reopenDueRepeats(db, userId, { timeZone: tz, now: Date.UTC(2026, 11, 9, 4) })).toBe(1);
    expect(getItem(db, userId, filter.id)).toMatchObject({
      completedAt: null,
      dueFrom: null,
      dueDate: "2026-12-09",
    });
    // The car waits for the weekend after it, not the 5th the schedule had.
    expect(reopenDueRepeats(db, userId, { timeZone: tz, now: Date.UTC(2026, 11, 12, 3, 59) })).toBe(0);
    expect(reopenDueRepeats(db, userId, { timeZone: tz, now: Date.UTC(2026, 11, 12, 4) })).toBe(1);
    expect(getItem(db, userId, car.id)).toMatchObject({
      completedAt: null,
      dueFrom: "2026-12-12",
      dueDate: "2026-12-13",
      repeatOn: "weekend",
    });
    // The completions are logged later than now, so find the reopening.
    expect(
      listAudit(db, userId).find((r) => r.entityId === car.id && r.action === "uncomplete")?.detail,
    ).toBe('reopened "Clean the car" (repeats every 2 weeks on weekends), due 2026-12-12 to 2026-12-13');
  });

  it("keeps a rule to days only when it's weekly or monthly", () => {
    const { db, userId, projectId } = seedProject();
    const add = (repeat: Repeat) =>
      addItem(db, userId, { projectId, title: "Bins", repeat }, "web");
    expect(() => add({ every: 3, unit: "day", on: "weekend" })).toThrow(/daily/);
    const bins = add({ every: 1, unit: "week", on: "mon" });
    // Changing only the days is a change, and logged as one.
    updateItem(db, userId, bins.id, { repeat: { every: 1, unit: "week", on: "tue" } }, "web");
    expect(getItem(db, userId, bins.id)?.repeatOn).toBe("tue");
    expect(listAudit(db, userId)[0].detail).toContain("repeats every week on Tuesdays");
  });

  it("brings a rule on a date back on that date, however late it's done", () => {
    const { db, userId, projectId } = seedProject();
    const rent = addItem(
      db,
      userId,
      { projectId, title: "Pay rent", dueDate: "2026-11-01", repeat: { every: 1, unit: "month", day: 1 } },
      "web",
    );
    expect(rent.repeatDay).toBe(1);
    expect(listAudit(db, userId)[0].detail).toContain("repeats every month on the 1st");
    // Paid three weeks late, on 21 November: back on 1 December, not 21st.
    completeAt(db, userId, rent.id, Date.UTC(2026, 10, 21, 12));
    expect(reopenDueRepeats(db, userId, { timeZone: tz, now: Date.UTC(2026, 10, 30, 12) })).toBe(0);
    expect(reopenDueRepeats(db, userId, { timeZone: tz, now: Date.UTC(2026, 11, 1, 4) })).toBe(1);
    expect(getItem(db, userId, rent.id)).toMatchObject({
      completedAt: null,
      dueFrom: null,
      dueDate: "2026-12-01",
      repeatDay: 1,
    });
  });

  it("keeps a rule to a date only when it's monthly, and to one date from 1 to 31", () => {
    const { db, userId, projectId } = seedProject();
    const add = (repeat: Repeat) =>
      addItem(db, userId, { projectId, title: "Rent", repeat }, "web");
    expect(() => add({ every: 1, unit: "week", day: 1 })).toThrow(/monthly/);
    expect(() => add({ every: 1, unit: "month", day: 1, on: "mon" })).toThrow(/not both/);
    expect(() => add({ every: 1, unit: "month", day: 32 })).toThrow(/repeat day/);
    expect(() => add({ every: 1, unit: "month", day: 0 })).toThrow(/repeat day/);
    const rent = add({ every: 1, unit: "month", day: 1 });
    // Changing only the date is a change, and logged as one; dropping it too.
    updateItem(db, userId, rent.id, { repeat: { every: 1, unit: "month", day: 31 } }, "web");
    expect(getItem(db, userId, rent.id)?.repeatDay).toBe(31);
    expect(listAudit(db, userId)[0].detail).toContain("repeats every month on the 31st");
    updateItem(db, userId, rent.id, { repeat: { every: 1, unit: "month" } }, "web");
    expect(getItem(db, userId, rent.id)?.repeatDay).toBeNull();
    expect(listAudit(db, userId)[0].detail).toMatch(/repeats every month$/);
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

describe("sorting a list", () => {
  const titles = (db: ReturnType<typeof seedProject>["db"], userId: string, projectId: string) =>
    nestItems(listItems(db, userId, projectId)).map((i) => i.title);

  it("sorts by due date soonest first, a span by its last day, undated last, ties in list order", () => {
    const { db, userId, projectId } = seedProject();
    addItem(db, userId, { projectId, title: "undated A", positionRef: "end" }, "web");
    addItem(db, userId, { projectId, title: "Nov 20", dueDate: "2026-11-20", positionRef: "end" }, "web");
    // Starts first but ends after Nov 20, so it sorts after it.
    addItem(
      db,
      userId,
      { projectId, title: "span to Nov 22", dueFrom: "2026-11-01", dueDate: "2026-11-22", positionRef: "end" },
      "web",
    );
    addItem(db, userId, { projectId, title: "Nov 10 first", dueDate: "2026-11-10", positionRef: "end" }, "web");
    addItem(db, userId, { projectId, title: "undated B", positionRef: "end" }, "web");
    addItem(db, userId, { projectId, title: "Nov 10 second", dueDate: "2026-11-10", positionRef: "end" }, "web");

    expect(sortItems(db, userId, projectId, "due", "web")).not.toBeNull();
    expect(titles(db, userId, projectId)).toEqual([
      "Nov 10 first",
      "Nov 10 second",
      "Nov 20",
      "span to Nov 22",
      "undated A",
      "undated B",
    ]);
  });

  it("sorts by date created newest first, and by name A to Z with numbers in order", () => {
    const { db, userId, projectId } = seedProject();
    const made = ["item 10", "Banana", "apple", "item 9"].map((title) =>
      addItem(db, userId, { projectId, title }, "web"),
    );
    // Created out of list order, so newest first isn't just the list reversed.
    [3, 1, 4, 2].forEach((ts, i) =>
      db.update(items).set({ createdAt: ts }).where(eq(items.id, made[i].id)).run(),
    );

    sortItems(db, userId, projectId, "created", "web");
    expect(titles(db, userId, projectId)).toEqual(["apple", "item 10", "item 9", "Banana"]);

    sortItems(db, userId, projectId, "title", "web");
    expect(titles(db, userId, projectId)).toEqual(["apple", "Banana", "item 9", "item 10"]);
  });

  it("sorts by priority highest first, ties in list order, then unscored open items, then done ones", () => {
    const { db, userId, projectId } = seedProject();
    const [done, low, finished, unscored, tieA, high, tieB] = [
      "done",
      "low",
      "finished meanwhile",
      "added meanwhile",
      "tie A",
      "high",
      "tie B",
    ].map((title) => addItem(db, userId, { projectId, title, positionRef: "end" }, "web"));
    completeItem(db, userId, done.id, "web");
    // Scored while open, then finished before the sort reads the list.
    completeItem(db, userId, finished.id, "web");
    const priority = new Map([
      [low.id, 0.1],
      [finished.id, 0.95],
      [tieA.id, 0.5],
      [high.id, 0.9],
      [tieB.id, 0.5],
    ]);
    expect(priority.has(unscored.id)).toBe(false);

    expect(sortItems(db, userId, projectId, "priority", "web", priority)).not.toBeNull();
    expect(
      listItems(db, userId, projectId, { includeCompleted: true }).map((i) => i.title),
    ).toEqual(["high", "tie A", "tie B", "low", "added meanwhile", "done", "finished meanwhile"]);
    expect(listAudit(db, userId, { projectId })[0].detail).toBe('sorted "P" by priority');
    // Without Jev's scores there's nothing to sort by.
    expect(() => sortItems(db, userId, projectId, "priority", "web")).toThrow(/needs each item's score/);
  });

  it("moves sub-items with their parent and keeps their own order", () => {
    const { db, userId, projectId } = seedProject();
    const b = addItem(db, userId, { projectId, title: "B", subItems: ["z", "y"] }, "web");
    addItem(db, userId, { projectId, title: "A" }, "web");

    sortItems(db, userId, projectId, "title", "web");
    const tree = nestItems(listItems(db, userId, projectId));
    expect(tree.map((i) => i.title)).toEqual(["A", "B"]);
    expect(tree[1].id).toBe(b.id);
    expect(tree[1].children.map((s) => s.title)).toEqual(["z", "y"]);
  });

  it("audits a sort once, and writes nothing when the list is already in order", () => {
    const { db, userId, projectId } = seedProject();
    addItem(db, userId, { projectId, title: "b", positionRef: "end" }, "web");
    addItem(db, userId, { projectId, title: "a", positionRef: "end" }, "web");
    const before = listAudit(db, userId, { projectId }).length;

    // As the sort_items tool calls it, so the row names the agent.
    const agent = { source: "mcp" as const, agent: { keyId: "key1", name: "Amp" } };
    sortItems(db, userId, projectId, "title", agent);
    const log = listAudit(db, userId, { projectId });
    expect(log).toHaveLength(before + 1);
    expect(log[0]).toMatchObject({
      source: "mcp",
      agentKeyId: "key1",
      agentName: "Amp",
      action: "reorder",
      entityType: "project",
      entityId: projectId,
      detail: 'sorted "P" by name',
    });

    expect(sortItems(db, userId, projectId, "title", agent)).toBeNull();
    expect(listAudit(db, userId, { projectId })).toHaveLength(before + 1);
  });

  it("undoes a sort, keeping items added since at the top", () => {
    const { db, userId, projectId } = seedProject();
    for (const title of ["c", "a", "b"]) addItem(db, userId, { projectId, title, positionRef: "end" }, "web");
    const previous = sortItems(db, userId, projectId, "title", "web");
    // Even one put at the end goes to the top, where new items go.
    addItem(db, userId, { projectId, title: "new", positionRef: "end" }, "web");

    if (!previous) throw new Error("expected the sort to change the order");
    setItemOrder(db, userId, projectId, previous, "web");
    expect(titles(db, userId, projectId)).toEqual(["new", "c", "a", "b"]);
    expect(listAudit(db, userId, { projectId })[0].detail).toBe('reordered the items in "P"');
  });

  it("refuses a list the user can't see, and an unknown sort", () => {
    const { db, userId, projectId } = seedProject();
    addItem(db, userId, { projectId, title: "b", positionRef: "end" }, "web");
    addItem(db, userId, { projectId, title: "a", positionRef: "end" }, "web");
    const other = createTestUser(db);
    expect(() => sortItems(db, other, projectId, "title", "web")).toThrow(/list not found/);
    expect(() => setItemOrder(db, other, projectId, [], "web")).toThrow(/list not found/);
    expect(() => sortItems(db, userId, projectId, "size" as never, "web")).toThrow(/invalid sort/);
    expect(titles(db, userId, projectId)).toEqual(["b", "a"]);
  });
});

describe("cancelItem", () => {
  function withSteps(steps: string[]) {
    const s = seedProject();
    const parent = addItem(s.db, s.userId, { projectId: s.projectId, title: "Notifications" }, "web");
    const ids = steps.map(
      (title) => addItem(s.db, s.userId, { projectId: s.projectId, title, parentId: parent.id }, "web").id,
    );
    return { ...s, parent, ids };
  }

  it("closes the item with its reason and replacement, without it counting as done", () => {
    const { db, userId, projectId } = seedProject();
    const old = addItem(db, userId, { projectId, title: "Inbox" }, "web");
    const repl = addItem(db, userId, { projectId, title: "Direct tier" }, "web");
    cancelItem(db, userId, old.id, { reason: "  replanned ", replacedById: repl.id }, "web");
    expect(getItem(db, userId, old.id)).toMatchObject({
      cancelled: true,
      cancelReason: "replanned",
      replacedById: repl.id,
      completedAt: expect.any(Number),
    });
    expect(listItems(db, userId, projectId).map((i) => i.title)).toEqual(["Direct tier"]);
    const [row] = listAudit(db, userId, { projectId }).filter((r) => r.action === "cancel");
    expect(row).toBeDefined();
  });

  it("completes the parent when the last open step is cancelled and another was done", () => {
    const { db, userId, parent, ids } = withSteps(["a", "b"]);
    completeItem(db, userId, ids[0], "web");
    cancelItem(db, userId, ids[1], {}, "web");
    expect(getItem(db, userId, parent.id)).toMatchObject({ cancelled: false, completedAt: expect.any(Number) });
  });

  it("leaves the parent open when every step was cancelled", () => {
    const { db, userId, parent, ids } = withSteps(["a", "b"]);
    cancelItem(db, userId, ids[0], {}, "web");
    cancelItem(db, userId, ids[1], {}, "web");
    expect(getItem(db, userId, parent.id)?.completedAt).toBeNull();
  });

  it("cancels a parent's open steps with it, leaving done ones done", () => {
    const { db, userId, parent, ids } = withSteps(["a", "b"]);
    completeItem(db, userId, ids[0], "web");
    cancelItem(db, userId, parent.id, { reason: "won't do" }, "web");
    expect(getItem(db, userId, ids[0])?.cancelled).toBe(false);
    expect(getItem(db, userId, ids[1])).toMatchObject({ cancelled: true, cancelReason: null });
  });

  it("clears the cancel on reopen, and a step reopening clears its cancelled parent", () => {
    const { db, userId, parent, ids } = withSteps(["a"]);
    cancelItem(db, userId, parent.id, { reason: "won't do" }, "web");
    uncompleteItem(db, userId, ids[0], "web");
    expect(getItem(db, userId, parent.id)).toMatchObject({ completedAt: null, cancelled: false, cancelReason: null });
  });

  it("never brings a cancelled repeating item round again", () => {
    const { db, userId, projectId } = seedProject();
    const it = addItem(
      db,
      userId,
      { projectId, title: "Water plants", dueDate: "2026-11-12", repeat: { every: 1, unit: "day" } },
      "web",
    );
    cancelItem(db, userId, it.id, {}, "web");
    expect(reopenDueRepeats(db, userId, { timeZone: "UTC", now: Date.now() + 30 * 86_400_000 })).toBe(0);
  });

  it("refuses a replacement the user can't see, or the item itself", () => {
    const { db, userId, projectId } = seedProject();
    const it = addItem(db, userId, { projectId, title: "x" }, "web");
    expect(() => cancelItem(db, userId, it.id, { replacedById: "nope" }, "web")).toThrow(/replacement not found/);
    expect(() => cancelItem(db, userId, it.id, { replacedById: it.id }, "web")).toThrow(/replace itself/);
    expect(getItem(db, userId, it.id)?.completedAt).toBeNull();
  });
});

describe("Someday", () => {
  const updates = (db: ReturnType<typeof seedProject>["db"], userId: string, id: string) =>
    listAudit(db, userId)
      .filter((e) => e.entityId === id && e.action === "update")
      .map((e) => e.detail)
      .reverse();

  it("takes the date, repeat and smart rule off in one audited change, and a date brings it back", () => {
    const { db, userId, projectId } = seedProject();
    const bins = addItem(
      db,
      userId,
      { projectId, title: "bins", dueDate: "2026-11-20", repeat: { every: 1, unit: "week" } },
      "web",
    );
    const someday = updateItem(db, userId, bins.id, { someday: true }, "web");
    expect(someday).toMatchObject({ dueDate: null, dueFrom: null, repeatUnit: null, repeatEvery: null });
    expect(someday.somedayAt).toEqual(expect.any(Number));
    expect(updates(db, userId, bins.id)).toEqual(["updated bins: moved to Someday"]);
    // Already Someday: no change, no row.
    updateItem(db, userId, bins.id, { someday: true }, "web");
    expect(updates(db, userId, bins.id)).toHaveLength(1);

    expect(updateItem(db, userId, bins.id, { dueDate: "2026-12-01" }, "web")).toMatchObject({
      somedayAt: null,
      dueDate: "2026-12-01",
    });
    updateItem(db, userId, bins.id, { someday: true }, "web");
    expect(updateItem(db, userId, bins.id, { someday: false }, "web")).toMatchObject({ somedayAt: null, dueDate: null });
    updateItem(db, userId, bins.id, { someday: true }, "web");
    expect(updateItem(db, userId, bins.id, { repeat: { every: 2, unit: "day" } }, "web").somedayAt).toBeNull();
    expect(updates(db, userId, bins.id)).toEqual([
      "updated bins: moved to Someday",
      "updated bins: due 2026-12-01",
      "updated bins: moved to Someday",
      "updated bins: out of Someday",
      "updated bins: moved to Someday",
      "updated bins: repeats every 2 days",
    ]);
  });

  it("drops a smart due date, and giving it one brings it back", () => {
    const { db, userId, projectId } = seedProject();
    const book = addItem(db, userId, { projectId, title: "book hotel" }, "web");
    setSmartRule(db, userId, book.id, { rule: "before our next trip", lead: 7 }, "web");
    expect(updateItem(db, userId, book.id, { someday: true }, "web").smartRule).toBeNull();
    const back = setSmartRule(db, userId, book.id, { rule: "before our next trip", lead: 7 }, "web");
    expect(back).toMatchObject({ somedayAt: null, smartRule: "before our next trip" });
  });

  it("is for top-level items: a sub-item is refused, and nesting one leaves Someday", () => {
    const { db, userId, projectId } = seedProject();
    const parent = addItem(db, userId, { projectId, title: "trip" }, "web");
    const line = addItem(db, userId, { projectId, title: "pack", parentId: parent.id }, "web");
    expect(() => updateItem(db, userId, line.id, { someday: true }, "web")).toThrow(/top-level/);
    expect(() => updateItem(db, userId, parent.id, { someday: true, dueDate: "2026-12-01" }, "web")).toThrow(
      /Someday/,
    );
    expect(getItem(db, userId, parent.id)).toMatchObject({ somedayAt: null, dueDate: null });

    const loose = addItem(db, userId, { projectId, title: "passport" }, "web");
    updateItem(db, userId, loose.id, { someday: true }, "web");
    expect(setItemParent(db, userId, loose.id, parent.id, "web").somedayAt).toBeNull();
  });

  it("leaves No date with its sub-items, while an undated sibling stays", () => {
    const { db, userId, projectId } = seedProject();
    const garden = addItem(db, userId, { projectId, title: "redo the garden" }, "web");
    addItem(db, userId, { projectId, title: "pick plants", parentId: garden.id }, "web");
    addItem(db, userId, { projectId, title: "tidy flat" }, "web");
    updateItem(db, userId, garden.id, { someday: true }, "web");
    const { lists } = listNoDate(db, userId, { timeZone: "UTC" });
    expect(lists.flatMap((l) => l.items.map((i) => i.title))).toEqual(["tidy flat"]);
  });
});
