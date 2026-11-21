import { describe, expect, it } from "vitest";
import { listAudit } from "./audit";
import { addItem, completeItem, deleteItem, getItem, setItemParent, uncompleteItem, updateItem } from "./items";
import { createProject } from "./projects";
import { acceptInvite, inviteMember } from "./members";
import { addSmartMatch, findSmartCandidates, getSmartDue, removeSmartMatch, setSmartRule } from "./smartDue";
import { createTestDb, createTestUser } from "./test-helpers";

function seed() {
  const { db } = createTestDb();
  const userId = createTestUser(db);
  const projectId = createProject(db, userId, { name: "Home" }, "web").id;
  const add = (title: string, dueDate: string | null = null, dueFrom: string | null = null) =>
    addItem(db, userId, { projectId, title, dueDate, dueFrom }, "web");
  const smart = add("Renew travel insurance");
  setSmartRule(db, userId, smart.id, { rule: "before our next trip", lead: 7 }, "web");
  const due = () => getItem(db, userId, smart.id)?.dueDate ?? null;
  return { db, userId, projectId, add, smart, due };
}

describe("smart due dates", () => {
  it("waits with no date until something matches", () => {
    const { due, db, userId, smart } = seed();
    expect(due()).toBeNull();
    expect(getSmartDue(db, userId, smart.id)).toMatchObject({ rule: "before our next trip", lead: 7, matches: [] });
  });

  it("is due `lead` days before the earliest open, dated match's first day", () => {
    const { db, userId, add, smart, due } = seed();
    const lisbon = add("Lisbon", "2027-03-08", "2027-03-03");
    const oslo = add("Oslo", "2027-05-10");
    const someday = add("Somewhere, someday");
    for (const a of [oslo, someday, lisbon]) addSmartMatch(db, userId, smart.id, a.id, "a trip", "web");
    // Lisbon starts 3 March (not its last day, 8 March): a week before.
    expect(due()).toBe("2027-02-24");
    const view = getSmartDue(db, userId, smart.id);
    expect(view?.matches.map((m) => [m.title, m.current])).toEqual([
      ["Lisbon", true],
      ["Oslo", false],
      ["Somewhere, someday", false],
    ]);
  });

  it("recalibrates when a sooner match arrives or a match moves, logged as Sidetrack", () => {
    const { db, userId, add, smart, due } = seed();
    const oslo = add("Oslo", "2027-05-10");
    addSmartMatch(db, userId, smart.id, oslo.id, "a trip", "web");
    expect(due()).toBe("2027-05-03");
    const lisbon = add("Lisbon");
    addSmartMatch(db, userId, smart.id, lisbon.id, "a trip", "web");
    // Undated, it doesn't count yet.
    expect(due()).toBe("2027-05-03");
    updateItem(db, userId, lisbon.id, { dueDate: "2027-03-03" }, "web");
    expect(due()).toBe("2027-02-24");

    const moves = listAudit(db, userId, { limit: 50 }).filter(
      (r) => r.entityId === smart.id && r.actor === "system",
    );
    expect(moves).toHaveLength(1);
    expect(moves[0].detail).toContain("moved earlier to");
    expect(moves[0].detail).toContain('from "Lisbon"');
  });

  it("moves on to the next match once one is done or deleted, and back when it reopens", () => {
    const { db, userId, add, smart, due } = seed();
    const lisbon = add("Lisbon", "2027-03-03");
    const oslo = add("Oslo", "2027-05-10");
    addSmartMatch(db, userId, smart.id, lisbon.id, null, "web");
    addSmartMatch(db, userId, smart.id, oslo.id, null, "web");
    completeItem(db, userId, lisbon.id, "web");
    expect(due()).toBe("2027-05-03");
    uncompleteItem(db, userId, lisbon.id, "web");
    expect(due()).toBe("2027-02-24");
    deleteItem(db, userId, lisbon.id, "web");
    expect(due()).toBe("2027-05-03");
    deleteItem(db, userId, oslo.id, "web");
    expect(due()).toBeNull();
  });

  it("keeps a removed match from counting, and lists only the rest", () => {
    const { db, userId, add, smart, due } = seed();
    const bq = add("Trip to B&Q", "2027-01-09");
    const oslo = add("Oslo", "2027-05-10");
    addSmartMatch(db, userId, smart.id, bq.id, "a trip", "web");
    addSmartMatch(db, userId, smart.id, oslo.id, "a trip", "web");
    expect(due()).toBe("2027-01-02");
    removeSmartMatch(db, userId, smart.id, bq.id, "web");
    expect(due()).toBe("2027-05-03");
    // Moving the removed one sooner changes nothing.
    updateItem(db, userId, bq.id, { dueDate: "2027-01-01" }, "web");
    expect(due()).toBe("2027-05-03");
    expect(getSmartDue(db, userId, smart.id)?.matches.map((m) => m.title)).toEqual(["Oslo"]);
  });

  it("follows a chain: a smart item can be another's match", () => {
    const { db, userId, add, smart, due } = seed();
    const trip = add("Lisbon", "2027-03-03");
    const flights = add("Book flights");
    setSmartRule(db, userId, flights.id, { rule: "before the trip", lead: 30 }, "web");
    addSmartMatch(db, userId, flights.id, trip.id, null, "web");
    addSmartMatch(db, userId, smart.id, flights.id, null, "web");
    expect(due()).toBe("2027-01-25"); // 3 Mar − 30 − 7
    updateItem(db, userId, trip.id, { dueDate: "2027-04-03" }, "web");
    expect(due()).toBe("2027-02-25");
    // And refuses a loop back.
    expect(() => addSmartMatch(db, userId, flights.id, smart.id, null, "web")).toThrow();
  });

  it("stops being smart when someone sets a date by hand", () => {
    const { db, userId, add, smart, due } = seed();
    const oslo = add("Oslo", "2027-05-10");
    addSmartMatch(db, userId, smart.id, oslo.id, null, "web");
    updateItem(db, userId, smart.id, { dueDate: "2027-04-01" }, "web");
    expect(due()).toBe("2027-04-01");
    expect(getSmartDue(db, userId, smart.id)).toBeNull();
    updateItem(db, userId, oslo.id, { dueDate: "2027-02-01" }, "web");
    expect(due()).toBe("2027-04-01");
  });

  it("doesn't name a match in a list the reader can't open", () => {
    const { db, userId, smart } = seed();
    const other = createTestUser(db);
    const theirs = createProject(db, other, { name: "Theirs" }, "web").id;
    const secret = addItem(db, other, { projectId: theirs, title: "Secret trip", dueDate: "2027-03-03" }, "web");
    // Someone who can't open it can't match it either.
    expect(() => addSmartMatch(db, userId, smart.id, secret.id, null, "web")).toThrow(/not found/);
  });

  it("ends a diamond on the right date with one move each, whatever order it was made in", () => {
    // D hangs off A and B; B hangs off A (5 days before). Moving A moves B,
    // and D must be worked out after B, not before it.
    for (const order of [["B", "D"], ["D", "B"]]) {
      for (const dFirst of [true, false]) {
        const { db, userId, add } = seed();
        const a = add("A", "2027-03-10");
        const made: Record<string, string> = {};
        for (const name of order) {
          made[name] = add(name).id;
          setSmartRule(db, userId, made[name], { rule: "around A", lead: name === "B" ? 5 : 0 }, "web");
        }
        addSmartMatch(db, userId, made.B, a.id, null, "web");
        const dAnchors = dFirst ? [a.id, made.B] : [made.B, a.id];
        for (const anchor of dAnchors) addSmartMatch(db, userId, made.D, anchor, null, "web");
        expect(getItem(db, userId, made.D)?.dueDate).toBe("2027-03-05");
        updateItem(db, userId, a.id, { dueDate: "2027-04-10" }, "web");
        expect(getItem(db, userId, made.B)?.dueDate).toBe("2027-04-05");
        expect(getItem(db, userId, made.D)?.dueDate).toBe("2027-04-05");
        const dMoves = listAudit(db, userId, { limit: 100 }).filter(
          (r) => r.entityId === made.D && r.actor === "system",
        );
        expect(dMoves).toHaveLength(1);
      }
    }
  });

  it("follows a match reopened by an open sub-item added or nested under it", () => {
    const { db, userId, add, smart, due } = seed();
    const trip = add("Lisbon", "2027-03-03");
    addSmartMatch(db, userId, smart.id, trip.id, null, "web");
    completeItem(db, userId, trip.id, "web");
    expect(due()).toBeNull();
    addItem(db, userId, { projectId: trip.projectId, title: "Pack", parentId: trip.id }, "web");
    expect(due()).toBe("2027-02-24");

    completeItem(db, userId, trip.id, "web");
    expect(due()).toBeNull();
    const loose = add("Book hotel");
    setItemParent(db, userId, loose.id, trip.id, "web");
    expect(due()).toBe("2027-02-24");
  });

  it("works out a smart item's own date when a sub-item reopens it", () => {
    const { db, userId, add, smart, due } = seed();
    const trip = add("Lisbon", "2027-03-03");
    addSmartMatch(db, userId, smart.id, trip.id, null, "web");
    completeItem(db, userId, smart.id, "web");
    updateItem(db, userId, trip.id, { dueDate: "2027-05-10" }, "web");
    // Done, it kept the old date.
    expect(due()).toBe("2027-02-24");
    addItem(db, userId, { projectId: trip.projectId, title: "Compare quotes", parentId: smart.id }, "web");
    expect(due()).toBe("2027-05-03");
  });

  it("keeps a hidden match's title and reason out of what a list member reads", () => {
    const { db } = createTestDb();
    const owner = createTestUser(db, { username: "owner" });
    const member = createTestUser(db, { username: "member" });
    const home = createProject(db, owner, { name: "Home" }, "web").id;
    const secret = createProject(db, owner, { name: "Secret" }, "web").id;
    inviteMember(db, owner, home, "member", "web");
    acceptInvite(db, member, home, "web");
    const smart = addItem(db, owner, { projectId: home, title: "Bake a cake" }, "web");
    const party = addItem(db, owner, { projectId: secret, title: "SURPRISE PARTY", dueDate: "2027-03-03" }, "web");
    setSmartRule(db, owner, smart.id, { rule: "before the party", lead: 1 }, "web");
    addSmartMatch(db, owner, smart.id, party.id, "the surprise party", "web");

    const seen = JSON.stringify(listAudit(db, member, { projectId: home, limit: 50 }));
    expect(seen).not.toContain("SURPRISE");
    expect(seen).toContain("an item you can't see");
    expect(getSmartDue(db, member, smart.id)?.matches).toEqual([
      expect.objectContaining({ title: null, ref: null, reason: null, current: true }),
    ]);
    // The owner still sees it all.
    expect(JSON.stringify(listAudit(db, owner, { projectId: home, limit: 50 }))).toContain("SURPRISE PARTY");
    expect(getSmartDue(db, owner, smart.id)?.matches[0]).toMatchObject({ title: "SURPRISE PARTY", reason: "the surprise party" });
  });

  it("searches candidates only for an item the user can change, and takes % and _ literally", () => {
    const { db, userId, add, smart } = seed();
    add("50% off sale");
    add("500 off sale");
    add("a_b");
    add("axb");
    expect(findSmartCandidates(db, userId, smart.id, "50%").map((c) => c.title)).toEqual(["50% off sale"]);
    expect(findSmartCandidates(db, userId, smart.id, "a_b").map((c) => c.title)).toEqual(["a_b"]);
    const other = createTestUser(db);
    const theirs = createProject(db, other, { name: "Theirs" }, "web").id;
    const hidden = addItem(db, other, { projectId: theirs, title: "Hidden" }, "web");
    expect(() => findSmartCandidates(db, userId, hidden.id, "sale")).toThrow(/not found/);
  });

  it("moves a dependent once when reopening a sub-item reopens its parent", () => {
    const { db, userId, add } = seed();
    const p = add("P", "2027-03-20");
    const c = addItem(db, userId, { projectId: p.projectId, title: "C", dueDate: "2027-03-10", parentId: p.id }, "web");
    const d = add("D");
    setSmartRule(db, userId, d.id, { rule: "before P or C", lead: 0 }, "web");
    addSmartMatch(db, userId, d.id, p.id, null, "web");
    addSmartMatch(db, userId, d.id, c.id, null, "web");
    completeItem(db, userId, p.id, "web");
    expect(getItem(db, userId, d.id)?.dueDate).toBeNull();
    uncompleteItem(db, userId, c.id, "web");
    expect(getItem(db, userId, d.id)?.dueDate).toBe("2027-03-10");
    const moves = listAudit(db, userId, { limit: 100 }).filter((r) => r.entityId === d.id && r.actor === "system");
    // One for completing P (no date), one for reopening C: never a passing 20 Mar.
    expect(moves.map((r) => r.detail).filter((t) => t?.includes("2027-03-20"))).toEqual([]);
  });
});
