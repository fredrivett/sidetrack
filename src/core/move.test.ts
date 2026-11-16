import { describe, expect, it } from "vitest";
import { listAudit } from "./audit";
import { resolveItemRef } from "./itemRef";
import { addItem, getItem, listItems } from "./items";
import { addLabel, listLabels } from "./labels";
import { acceptInvite, inviteMember } from "./members";
import { moveItem, previewMoveItem } from "./move";
import { createProject } from "./projects";
import { createTestDb, createTestUser } from "./test-helpers";

function seed() {
  const { db } = createTestDb();
  const fred = createTestUser(db, { username: "fred" });
  const eng = createProject(db, fred, { name: "Engineering" }, "web");
  const ops = createProject(db, fred, { name: "Ops" }, "web");
  // Ops already has two items, so moved ones can't keep their numbers.
  const first = addItem(db, fred, { projectId: ops.id, title: "Rotate keys" }, "web");
  addItem(db, fred, { projectId: ops.id, title: "Patch hosts" }, "web");
  return { db, fred, eng, ops, first };
}

const tokenFor = (db: Parameters<typeof previewMoveItem>[0], userId: string, id: string, projectId: string) =>
  previewMoveItem(db, userId, id, projectId).token;

const resolved = (r: ReturnType<typeof resolveItemRef>) =>
  r.status === "ok" ? r.item.id : r.status;

describe("moveItem", () => {
  it("moves an item and its sub-items to the top of the list, with new refs, keeping the old ones", () => {
    const { db, fred, eng, ops, first } = seed();
    addItem(db, fred, { projectId: eng.id, title: "Filler" }, "web");
    const item = addItem(
      db,
      fred,
      { projectId: eng.id, title: "Fix login", subItems: ["Repro", "Patch"] },
      "web",
    );
    const [repro, patch] = listItems(db, fred, eng.id).filter((i) => i.parentId === item.id);

    const preview = previewMoveItem(db, fred, item.id, ops.id);
    expect(preview.refs).toEqual([
      { id: item.id, title: "Fix login", from: "ENG-2", to: "OPS-3" },
      { id: repro.id, title: "Repro", from: "ENG-3", to: "OPS-4" },
      { id: patch.id, title: "Patch", from: "ENG-4", to: "OPS-5" },
    ]);
    // Previewing changes nothing.
    expect(getItem(db, fred, item.id)?.projectId).toBe(eng.id);

    const result = moveItem(db, fred, item.id, { projectId: ops.id, token: tokenFor(db, fred, item.id, ops.id) }, "web");
    expect(result.refs).toEqual(preview.refs);

    const there = listItems(db, fred, ops.id);
    expect(there.filter((i) => !i.parentId).map((i) => i.title)).toEqual([
      "Fix login",
      "Rotate keys",
      "Patch hosts",
    ]);
    expect(there.filter((i) => i.parentId === item.id).map((i) => [i.title, i.number])).toEqual([
      ["Repro", 4],
      ["Patch", 5],
    ]);
    expect(listItems(db, fred, eng.id).map((i) => i.title)).toEqual(["Filler"]);

    // Old and new refs both find each item; Ops' own items are untouched.
    for (const { id, from, to } of result.refs) {
      expect(resolved(resolveItemRef(db, fred, from))).toBe(id);
      expect(resolved(resolveItemRef(db, fred, `fred/${from}`))).toBe(id);
      expect(resolved(resolveItemRef(db, fred, to))).toBe(id);
    }
    expect(resolved(resolveItemRef(db, fred, "OPS-1"))).toBe(first.id);

    // A new item in Engineering doesn't take a number an old ref still names.
    const next = addItem(db, fred, { projectId: eng.id, title: "Next" }, "web");
    expect(next.number).toBe(5);
    // Nor does one in Ops take a number a moved item has there.
    expect(addItem(db, fred, { projectId: ops.id, title: "Later" }, "web").number).toBe(6);
  });

  it("logs the move in both lists' history, and the item's", () => {
    const { db, fred, eng, ops } = seed();
    const item = addItem(db, fred, { projectId: eng.id, title: "Fix login", subItems: ["Repro"] }, "web");
    const [sub] = listItems(db, fred, eng.id).filter((i) => i.parentId);
    moveItem(db, fred, item.id, { projectId: ops.id, token: tokenFor(db, fred, item.id, ops.id) }, { source: "mcp", agent: { keyId: "k1", name: "Claude" } });

    const moves = (projectId: string) =>
      listAudit(db, fred, { projectId })
        .filter((e) => e.detail.startsWith("moved"))
        .map((e) => [e.entityId, e.source, e.agentName, e.detail]);
    expect(moves(eng.id)).toEqual(
      expect.arrayContaining([
        [item.id, "mcp", "Claude", 'moved "Fix login" (ENG-1) to "Ops" as OPS-3, with 1 sub-items'],
        [sub.id, "mcp", "Claude", 'moved "Repro" with "Fix login" (ENG-2) to "Ops" as OPS-4'],
      ]),
    );
    expect(moves(eng.id)).toHaveLength(2);
    expect(moves(ops.id)).toEqual(
      expect.arrayContaining([
        [item.id, "mcp", "Claude", 'moved "Fix login" in from "Engineering" (ENG-1 → OPS-3), with 1 sub-items'],
        [sub.id, "mcp", "Claude", 'moved "Repro" with "Fix login" in from "Engineering" (ENG-2 → OPS-4)'],
      ]),
    );
    expect(moves(ops.id)).toHaveLength(2);
    // The parent's history keeps its sub-item's move.
    expect(
      listAudit(db, fred, { itemId: item.id }).filter((e) => e.entityId === sub.id && e.detail.startsWith("moved")),
    ).toHaveLength(2);
  });

  it("only does a move as it was previewed", () => {
    const { db, fred, eng, ops } = seed();
    const amy = createTestUser(db, { username: "amy" });
    const item = addItem(db, fred, { projectId: eng.id, title: "Fix login", labels: ["Bug"] }, "web");
    const { token } = previewMoveItem(db, fred, item.id, ops.id);
    const move = (t: string) =>
      moveItem(db, fred, item.id, { projectId: ops.id, token: t, missingLabels: "drop" }, "web");

    // No preview, or another item's or user's preview, moves nothing.
    expect(() => move("")).toThrow(/preview it again/);
    const other = addItem(db, fred, { projectId: eng.id, title: "Other", labels: ["Bug"] }, "web");
    expect(() => move(previewMoveItem(db, fred, other.id, ops.id).token)).toThrow(/preview it again/);
    inviteMember(db, fred, eng.id, "amy", "web");
    acceptInvite(db, amy, eng.id, "web");
    inviteMember(db, fred, ops.id, "amy", "web");
    acceptInvite(db, amy, ops.id, "web");
    expect(() => move(previewMoveItem(db, amy, item.id, ops.id).token)).toThrow(/preview it again/);

    // The target list gaining the label changes the move: "Bug" would now
    // match rather than be dropped, so the old preview no longer holds.
    addLabel(db, fred, ops.id, { name: "Bug" }, "web");
    expect(() => move(token)).toThrow(/preview it again/);
    expect(getItem(db, fred, item.id)?.projectId).toBe(eng.id);

    move(previewMoveItem(db, fred, item.id, ops.id).token);
    expect(getItem(db, fred, item.id)).toMatchObject({ projectId: ops.id, labels: ["Bug"] });
  });

  it("puts the item where it's asked to among the list's top-level items", () => {
    const { db, fred, eng, ops, first } = seed();
    const at = (title: string, position: string) => {
      const item = addItem(db, fred, { projectId: eng.id, title }, "web");
      moveItem(db, fred, item.id, { projectId: ops.id, token: tokenFor(db, fred, item.id, ops.id), position }, "web");
    };
    at("After rotate", `after:${first.id}`);
    at("Last", "end");
    at("Before rotate", `before:${first.id}`);
    expect(listItems(db, fred, ops.id).map((i) => i.title)).toEqual([
      "Before rotate",
      "Rotate keys",
      "After rotate",
      "Patch hosts",
      "Last",
    ]);
    // An anchor that isn't a top-level item there moves nothing.
    const stray = addItem(db, fred, { projectId: eng.id, title: "Stray" }, "web");
    expect(() =>
      moveItem(db, fred, stray.id, { projectId: ops.id, token: tokenFor(db, fred, stray.id, ops.id), position: `after:${stray.id}` }, "web"),
    ).toThrow(/anchor not found/);
    expect(getItem(db, fred, stray.id)?.projectId).toBe(eng.id);
  });

  it("moves a sub-item on its own out of its checklist", () => {
    const { db, fred, eng, ops } = seed();
    const parent = addItem(db, fred, { projectId: eng.id, title: "Fix login", subItems: ["Repro"] }, "web");
    const [sub] = listItems(db, fred, eng.id).filter((i) => i.parentId);
    moveItem(db, fred, sub.id, { projectId: ops.id, token: tokenFor(db, fred, sub.id, ops.id) }, "web");
    const moved = getItem(db, fred, sub.id);
    expect(moved).toMatchObject({ projectId: ops.id, parentId: null, number: 3 });
    expect(listItems(db, fred, eng.id).map((i) => i.id)).toEqual([parent.id]);
  });

  it("gives an item its old number back when it moves back", () => {
    const { db, fred, eng, ops } = seed();
    addItem(db, fred, { projectId: eng.id, title: "Filler" }, "web");
    const item = addItem(db, fred, { projectId: eng.id, title: "Fix login" }, "web");
    moveItem(db, fred, item.id, { projectId: ops.id, token: tokenFor(db, fred, item.id, ops.id) }, "web");
    const back = previewMoveItem(db, fred, item.id, eng.id);
    expect(back.refs[0]).toMatchObject({ from: "OPS-3", to: "ENG-2" });
    moveItem(db, fred, item.id, { projectId: eng.id, token: tokenFor(db, fred, item.id, eng.id) }, "web");
    expect(getItem(db, fred, item.id)?.number).toBe(2);
    // OPS-3 now points back to it; ENG-2 is it again.
    expect(resolved(resolveItemRef(db, fred, "OPS-3"))).toBe(item.id);
    expect(resolved(resolveItemRef(db, fred, "ENG-2"))).toBe(item.id);
    // And it can go to Ops again, taking OPS-3 back.
    moveItem(db, fred, item.id, { projectId: ops.id, token: tokenFor(db, fred, item.id, ops.id) }, "web");
    expect(getItem(db, fred, item.id)?.number).toBe(3);
    expect(resolved(resolveItemRef(db, fred, "ENG-2"))).toBe(item.id);
  });

  it("matches labels by name, and creates or drops the rest as asked", () => {
    const { db, fred, eng, ops } = seed();
    addItem(db, fred, { projectId: ops.id, title: "x", labels: ["Bug"] }, "web");
    const make = () =>
      addItem(
        db,
        fred,
        {
          projectId: eng.id,
          title: "Fix login",
          labels: ["bug", "Frontend"],
          labelEmoji: { Frontend: { emoji: "🎨", chosen: true } },
        },
        "web",
      );

    const item = make();
    expect(previewMoveItem(db, fred, item.id, ops.id)).toMatchObject({
      matchedLabels: [{ from: "bug", to: "Bug", itemIds: [item.id] }],
      missingLabels: [{ name: "Frontend", itemIds: [item.id] }],
    });
    // Missing labels need a choice; without one nothing moves.
    expect(() => moveItem(db, fred, item.id, { projectId: ops.id, token: tokenFor(db, fred, item.id, ops.id) }, "web")).toThrow(/Frontend/);
    expect(getItem(db, fred, item.id)?.projectId).toBe(eng.id);

    moveItem(db, fred, item.id, { projectId: ops.id, token: tokenFor(db, fred, item.id, ops.id), missingLabels: "drop" }, "web");
    expect(getItem(db, fred, item.id)?.labels).toEqual(["Bug"]);
    expect(listLabels(db, fred, ops.id).map((l) => l.name)).toEqual(["Bug"]);

    const other = make();
    moveItem(db, fred, other.id, { projectId: ops.id, token: tokenFor(db, fred, other.id, ops.id), missingLabels: "create" }, "web");
    expect(getItem(db, fred, other.id)?.labels).toEqual(["Bug", "Frontend"]);
    expect(listLabels(db, fred, ops.id).map((l) => [l.name, l.emoji, l.emojiChosen])).toEqual([
      ["Bug", null, false],
      ["Frontend", "🎨", true],
    ]);
  });

  it("creates one label for spellings of it that differ only in case", () => {
    const { db, fred, eng, ops } = seed();
    const item = addItem(db, fred, { projectId: eng.id, title: "Fix login", labels: ["Bug"] }, "web");
    const sub = addItem(db, fred, { projectId: eng.id, title: "Repro", parentId: item.id, labels: ["bug"] }, "web");
    expect(previewMoveItem(db, fred, item.id, ops.id).missingLabels).toEqual([
      { name: "Bug", itemIds: [item.id, sub.id] },
    ]);
    moveItem(
      db,
      fred,
      item.id,
      { projectId: ops.id, token: tokenFor(db, fred, item.id, ops.id), missingLabels: "create" },
      "web",
    );
    expect(listLabels(db, fred, ops.id).map((l) => l.name)).toEqual(["Bug"]);
    expect(getItem(db, fred, sub.id)?.labels).toEqual(["Bug"]);
  });

  it("creates or drops each missing label as chosen for it, and says which items carry each", () => {
    const { db, fred, eng, ops } = seed();
    addLabel(db, fred, ops.id, { name: "Bug" }, "web");
    const item = addItem(db, fred, { projectId: eng.id, title: "Fix login", labels: ["infra"] }, "web");
    const sub = addItem(
      db,
      fred,
      { projectId: eng.id, title: "Repro", parentId: item.id, labels: ["bug", "infra", "urgent"] },
      "web",
    );
    const preview = previewMoveItem(db, fred, item.id, ops.id);
    expect(preview.matchedLabels).toEqual([{ from: "bug", to: "Bug", itemIds: [sub.id] }]);
    expect(preview.missingLabels).toEqual([
      { name: "infra", itemIds: [item.id, sub.id] },
      { name: "urgent", itemIds: [sub.id] },
    ]);
    const move = (missingLabels: Record<string, "create" | "drop">) =>
      moveItem(db, fred, item.id, { projectId: ops.id, token: preview.token, missingLabels }, "web");

    // Every missing label needs a choice, and only those labels take one.
    expect(() => move({ infra: "create" })).toThrow(/no urgent label/);
    expect(() => move({ infra: "create", urgent: "drop", Bug: "drop" })).toThrow(/not a missing label of this move: Bug/);
    // A forged value isn't taken as a choice.
    expect(() => move({ infra: "create", urgent: "keep" as "drop" })).toThrow(/not a label choice: keep/);
    expect(getItem(db, fred, item.id)?.projectId).toBe(eng.id);

    move({ infra: "create", urgent: "drop" });
    expect(getItem(db, fred, item.id)?.labels).toEqual(["infra"]);
    expect(getItem(db, fred, sub.id)?.labels).toEqual(["Bug", "infra"]);
    expect(listLabels(db, fred, ops.id).map((l) => l.name)).toEqual(["Bug", "infra"]);
    expect(
      listAudit(db, fred, { projectId: ops.id }).find((e) => e.entityId === item.id)?.detail,
    ).toMatch(/dropped labels urgent$/);
  });

  it("takes people who can't see the list off the items", () => {
    const { db, fred, eng, ops } = seed();
    const amy = createTestUser(db, { username: "amy", name: "Amy" });
    inviteMember(db, fred, eng.id, "amy", "web");
    acceptInvite(db, amy, eng.id, "web");
    const item = addItem(
      db,
      fred,
      { projectId: eng.id, title: "Fix login", assigneeIds: [fred, amy], subItems: [] },
      "web",
    );
    const sub = addItem(db, fred, { projectId: eng.id, title: "Repro", parentId: item.id, assigneeIds: [amy] }, "web");

    expect(previewMoveItem(db, fred, item.id, ops.id).unassigned).toEqual([
      { userId: amy, name: "@amy", itemIds: [item.id, sub.id] },
    ]);
    moveItem(db, fred, item.id, { projectId: ops.id, token: tokenFor(db, fred, item.id, ops.id) }, "web");
    expect(getItem(db, fred, item.id)?.assigneeIds).toEqual([fred]);
    expect(getItem(db, fred, sub.id)?.assigneeIds).toEqual([]);
  });

  it("refuses lists the user can't see, archived lists, and the list it's in", () => {
    const { db, fred, eng } = seed();
    const bob = createTestUser(db, { username: "bob" });
    const bobs = createProject(db, bob, { name: "Bob's" }, "web");
    const archived = createProject(db, fred, { name: "Old", status: "archived" }, "web");
    const item = addItem(db, fred, { projectId: eng.id, title: "Fix login" }, "web");
    expect(() => moveItem(db, fred, item.id, { projectId: bobs.id, token: tokenFor(db, fred, item.id, bobs.id) }, "web")).toThrow(/list not found/);
    expect(() => moveItem(db, fred, item.id, { projectId: archived.id, token: tokenFor(db, fred, item.id, archived.id) }, "web")).toThrow(/archived/);
    expect(() => moveItem(db, fred, item.id, { projectId: eng.id, token: tokenFor(db, fred, item.id, eng.id) }, "web")).toThrow(/already/);
    // Someone who can't see the item can't move it.
    expect(() => moveItem(db, bob, item.id, { projectId: bobs.id, token: tokenFor(db, bob, item.id, bobs.id) }, "web")).toThrow(/item not found/);
  });

  it("doesn't let an old ref reach an item that moved somewhere the viewer can't see", () => {
    const { db, fred, eng, ops } = seed();
    const amy = createTestUser(db, { username: "amy" });
    inviteMember(db, fred, eng.id, "amy", "web");
    acceptInvite(db, amy, eng.id, "web");
    const item = addItem(db, fred, { projectId: eng.id, title: "Fix login" }, "web");
    expect(resolved(resolveItemRef(db, amy, "fred/ENG-1"))).toBe(item.id);
    moveItem(db, fred, item.id, { projectId: ops.id, token: tokenFor(db, fred, item.id, ops.id) }, "web");
    expect(resolveItemRef(db, amy, "fred/ENG-1")).toEqual({ status: "not_found", reason: "number" });
    expect(resolved(resolveItemRef(db, fred, "ENG-1"))).toBe(item.id);
  });
});
