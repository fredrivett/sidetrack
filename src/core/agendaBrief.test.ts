import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAgendaBrief } from "./agendaBrief";
import { addItem, cancelItem, completeItem } from "./items";
import { acceptInvite, inviteMember, removeMember } from "./members";
import { addComment } from "./comments";
import { createProject, updateProject } from "./projects";
import { createTestDb, createTestUser } from "./test-helpers";

const tz = "Europe/London";
const at = (day: string, hour = 9) => Date.parse(`${day}T${String(hour).padStart(2, "0")}:00:00Z`);
// Wednesday 18 November 2026, 9am in London (GMT).
const NOW = at("2026-11-18");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

/** Fred's Home list, which Sam is on too when it's `shared`. */
function board({ shared = false } = {}) {
  const { db } = createTestDb();
  const fred = createTestUser(db, { username: "fred" });
  const sam = createTestUser(db, { username: "sam" });
  const home = createProject(db, fred, { name: "Home" }, "web");
  if (shared) {
    inviteMember(db, fred, home.id, "sam", "web");
    acceptInvite(db, sam, home.id, "web");
  }
  const add = (
    title: string,
    more: { dueDate?: string; dueFrom?: string; assigneeIds?: string[]; parentId?: string } = {},
  ) => addItem(db, fred, { projectId: home.id, title, ...more }, "web");
  const brief = (opts: { now?: number; since?: number | null } = {}) =>
    buildAgendaBrief(db, fred, { now: opts.now ?? NOW, timeZone: tz, since: opts.since ?? null });
  return { db, fred, sam, home, add, brief };
}

const titles = (list: Array<{ title: string }>) => list.map((i) => i.title);

describe("buildAgendaBrief", () => {
  it("on a shared list, counts the viewer's items, and steps only under a parent that's theirs too", () => {
    const { fred, sam, add, brief } = board({ shared: true });
    const today = "2026-11-18";
    add("Fred's", { dueDate: today, assigneeIds: [fred] });
    add("Nobody's", { dueDate: today });
    const samsParent = add("Sam's", { dueDate: today, assigneeIds: [sam] });
    add("Loose step under Sam's", { dueDate: today, parentId: samsParent.id });
    add("Fred's step under Sam's", { dueDate: today, parentId: samsParent.id, assigneeIds: [fred] });
    const shared = add("Fred's with steps", { dueDate: today, assigneeIds: [fred] });
    add("Step one", { parentId: shared.id });
    add("Step two", { parentId: shared.id, assigneeIds: [sam] });

    const b = brief();
    // Nobody's isn't Fred's, though he added it: Sam is on the list too.
    expect(titles(b.dueToday)).toEqual(["Fred's", "Fred's step under Sam's", "Fred's with steps"]);
    // Sam's step isn't Fred's to count.
    expect(b.dueToday.find((i) => i.title === "Fred's with steps")?.stepsLeft).toBe(1);
    expect(b.dueToday.find((i) => i.title === "Fred's step under Sam's")?.parent).toBe("Sam's");
  });

  it("counts unassigned items only where nobody else can be assigned, whoever added them", () => {
    const { db, fred, sam, home, add, brief } = board({ shared: true });
    const today = "2026-11-18";
    const bySam = (title: string, more: { parentId?: string; assigneeIds?: string[] } = {}) =>
      addItem(db, sam, { projectId: home.id, title, dueDate: today, ...more }, "web");
    bySam("Sam's errand");
    add("Fred's errand", { dueDate: today });
    const tidy = add("Tidy flat", { dueDate: today, assigneeIds: [fred] });
    bySam("Kitchen", { parentId: tidy.id });
    bySam("Assigned to Fred by Sam", { assigneeIds: [fred] });

    const b = brief();
    expect(titles(b.dueToday)).toEqual(["Tidy flat", "Kitchen", "Assigned to Fred by Sam"]);
    // Sam's step on Fred's task is part of it.
    expect(b.dueToday[0].stepsLeft).toBe(1);
    // Nor are the unassigned ones Sam's, his own included.
    expect(buildAgendaBrief(db, sam, { now: NOW, timeZone: tz, since: null }).dueToday).toEqual([]);

    // Once Sam leaves, nobody else can be assigned on the list (Jo only
    // views it) and everything on it is Fred's.
    removeMember(db, fred, home.id, sam, "web");
    const jo = createTestUser(db, { username: "jo" });
    inviteMember(db, fred, home.id, "jo", "web", "viewer");
    acceptInvite(db, jo, home.id, "web");
    expect(titles(brief().dueToday)).toEqual([
      "Sam's errand",
      "Fred's errand",
      "Tidy flat",
      "Kitchen",
      "Assigned to Fred by Sam",
    ]);
    // Jo can't be assigned them, so none of them are hers.
    expect(buildAgendaBrief(db, jo, { now: NOW, timeZone: tz, since: null }).dueToday).toEqual([]);
  });

  it("reads the viewer's own clock: 2am on Saturday is still Friday evening", () => {
    const { brief } = board();
    const b = brief({ now: at("2026-11-21", 2) });
    expect(b).toMatchObject({
      today: "2026-11-20",
      weekday: "Friday",
      weekend: false,
      partOfDay: "evening",
    });
    expect(brief({ now: at("2026-11-21", 13) })).toMatchObject({
      weekday: "Saturday",
      weekend: true,
      partOfDay: "afternoon",
    });
  });

  it("looks back to the last read: what the viewer finished and what slipped meanwhile", () => {
    const { db, fred, sam, add: addAny, brief } = board({ shared: true });
    // Fred's, so they count with Sam on the list.
    const add = (title: string, more: { dueDate?: string; parentId?: string } = {}) =>
      addAny(title, { assigneeIds: [fred], ...more });
    const since = at("2026-11-16"); // Monday
    const beforeRead = add("Done before the read");
    const mineDone = add("Done since");
    const samsDone = add("Sam ticked it");
    const parent = add("Parent with a step");
    add("Its step", { parentId: parent.id });
    add("Due Monday", { dueDate: "2026-11-16" });
    add("Due Tuesday", { dueDate: "2026-11-17" });
    add("Due last week", { dueDate: "2026-11-10" });
    add("Due today", { dueDate: "2026-11-18" });

    vi.setSystemTime(at("2026-11-15"));
    completeItem(db, fred, beforeRead.id, "web");
    vi.setSystemTime(at("2026-11-17"));
    completeItem(db, fred, mineDone.id, "web");
    completeItem(db, sam, samsDone.id, "web");
    vi.setSystemTime(at("2026-11-17", 10));
    completeItem(db, fred, parent.id, "web");
    vi.setSystemTime(NOW);

    const b = brief({ since });
    expect(b.sinceDay).toBe("2026-11-16");
    // Newest first; the step went with its parent.
    expect(titles(b.lookBack.finished)).toEqual(["Parent with a step", "Done since"]);
    // Monday's was due on the day of the read, so it slipped after it; last
    // week's was already late.
    expect(titles(b.lookBack.slipped)).toEqual(["Due Tuesday", "Due Monday"]);
    expect(titles(b.overdue)).toEqual(["Due Monday", "Due Tuesday", "Due last week"]);

    // No read yet: nothing to look back on.
    expect(brief().lookBack).toEqual({ finished: [], finishedCount: 0, slipped: [] });
  });

  it("counts what's finished today in the viewer's day, as their shared day does, whenever it was due", () => {
    const { db, fred, add: addAny, brief } = board();
    const add = (title: string, more: { dueDate?: string; parentId?: string } = {}) =>
      addAny(title, { assigneeIds: [fred], ...more });
    const done = (title: string, more: { dueDate?: string; parentId?: string } = {}) =>
      completeItem(db, fred, add(title, more).id, "web");
    done("Due today", { dueDate: "2026-11-18" });
    done("Due Monday", { dueDate: "2026-11-16" });
    done("Due Friday", { dueDate: "2026-11-20" });
    const parent = add("Due today with steps", { dueDate: "2026-11-18" });
    add("Open step", { parentId: parent.id });
    const stepYesterday = add("Step done yesterday", { parentId: parent.id });
    done("Step of today's item", { parentId: parent.id });
    // Not in the day: undated, a step of an item due next week, cancelled,
    // finished yesterday, or unassigned, though nobody else can be assigned here.
    done("Undated");
    const later = add("Due next week", { dueDate: "2026-11-25" });
    add("Its open step", { parentId: later.id });
    done("Its step", { parentId: later.id });
    cancelItem(db, fred, add("Cancelled", { dueDate: "2026-11-18" }).id, {}, "web");
    completeItem(db, fred, addAny("Unassigned", { dueDate: "2026-11-18" }).id, "web");
    const yesterday = add("Done yesterday", { dueDate: "2026-11-17" });
    vi.setSystemTime(at("2026-11-17"));
    completeItem(db, fred, yesterday.id, "web");
    completeItem(db, fred, stepYesterday.id, "web");
    vi.setSystemTime(NOW);

    expect(brief().doneToday).toBe(4);
  });

  it("caps each look-back list at ten, counts all that were finished, and lets neither crowd out the other", () => {
    const { db, fred, add, brief } = board();
    for (let h = 0; h < 12; h++) {
      const item = add(`Done at ${h}`);
      vi.setSystemTime(at("2026-11-17", h + 6));
      completeItem(db, fred, item.id, "web");
      vi.setSystemTime(NOW);
    }
    for (let d = 0; d < 12; d++) add(`Slipped ${d}`, { dueDate: "2026-11-17" });
    const b = brief({ since: at("2026-11-16") });
    expect(b.lookBack.finishedCount).toBe(12);
    expect(b.lookBack.finished).toHaveLength(10);
    expect(b.lookBack.finished[0].title).toBe("Done at 11");
    expect(b.lookBack.slipped).toHaveLength(10);
  });

  it("looks back a week at most, however long ago the last read was", () => {
    const { db, fred, add, brief } = board();
    const old = add("Done three weeks ago");
    const recent = add("Done on Monday");
    vi.setSystemTime(at("2026-10-28"));
    completeItem(db, fred, old.id, "web");
    vi.setSystemTime(at("2026-11-16"));
    completeItem(db, fred, recent.id, "web");
    vi.setSystemTime(NOW);
    add("Due a fortnight ago", { dueDate: "2026-11-04" });
    const b = brief({ since: at("2026-10-01") });
    expect(b.since).toBe(NOW - 7 * 86_400_000);
    expect(titles(b.lookBack.finished)).toEqual(["Done on Monday"]);
    expect(b.lookBack.slipped).toEqual([]);
  });

  it("reads the day in the viewer's zone, not the server's", () => {
    const { db, fred } = board();
    // 4pm UTC on Wednesday is 5am Thursday in Auckland.
    const b = buildAgendaBrief(db, fred, {
      now: at("2026-11-18", 16),
      timeZone: "Pacific/Auckland",
      since: null,
    });
    expect(b).toMatchObject({ today: "2026-11-19", weekday: "Thursday", partOfDay: "morning" });
  });

  it("leaves out lists the viewer can't see and archived ones", () => {
    const { db, fred, sam, add, brief } = board();
    const samsOwn = createProject(db, sam, { name: "Sam's private" }, "web");
    addItem(db, sam, { projectId: samsOwn.id, title: "Sam's secret", dueDate: "2026-11-18" }, "web");
    const old = createProject(db, fred, { name: "Old" }, "web");
    addItem(db, fred, { projectId: old.id, title: "Archived", dueDate: "2026-11-18" }, "web");
    updateProject(db, fred, old.id, { status: "archived" }, "web");
    add("Mine", { dueDate: "2026-11-18" });
    expect(titles(brief().dueToday)).toEqual(["Mine"]);
  });

  it("counts single days ahead to the end of next week, and lists what's left this week", () => {
    const { add, brief } = board();
    add("Thursday one", { dueDate: "2026-11-19" });
    add("Thursday two", { dueDate: "2026-11-19" });
    add("Next Sunday", { dueDate: "2026-11-29" });
    add("Too far", { dueDate: "2026-11-30" });
    add("This week", { dueFrom: "2026-11-16", dueDate: "2026-11-22" });
    add("Next week", { dueFrom: "2026-11-23", dueDate: "2026-11-29" });

    const b = brief();
    expect(b.ahead.map((d) => d.day)).toEqual([
      "2026-11-19",
      "2026-11-20",
      "2026-11-21",
      "2026-11-22",
      "2026-11-23",
      "2026-11-24",
      "2026-11-25",
      "2026-11-26",
      "2026-11-27",
      "2026-11-28",
      "2026-11-29",
    ]);
    expect(b.ahead[0].open).toBe(2);
    expect(b.ahead.at(-1)?.open).toBe(1);
    expect(b.ahead.reduce((n, d) => n + d.open, 0)).toBe(3);
    // The Agenda's This week (it's Wednesday): the span under way first, as
    // it started Monday, then the days to come; nothing from next week.
    expect(titles(b.thisWeek)).toEqual(["This week", "Thursday one", "Thursday two"]);
  });

  it("keeps a step due this week when its parent isn't in This week, and folds it into one that is", () => {
    const { add, brief } = board();
    const move = add("Move house");
    add("Book the van", { dueDate: "2026-11-20", parentId: move.id });
    const trip = add("Trip", { dueDate: "2026-11-25" });
    add("Pack bags", { dueDate: "2026-11-21", parentId: trip.id });
    const party = add("Party", { dueDate: "2026-11-21" });
    add("Buy cake", { dueDate: "2026-11-20", parentId: party.id });
    expect(titles(brief().thisWeek)).toEqual(["Book the van", "Pack bags", "Party"]);
  });

  it("finds stale undated items by their last change, and recent or deadline-ish ones to nudge", () => {
    const { db, fred, add, brief } = board();
    vi.setSystemTime(at("2026-10-01"));
    add("Old and untouched");
    const busy = add("Old but its checklist grew");
    add("Renew passport");
    add("Old and plain");
    const discussed = add("Old but discussed");
    vi.setSystemTime(at("2026-11-16"));
    add("A step added this week", { parentId: busy.id });
    add("Added this week");
    addComment(db, fred, discussed.id, "Still on it", "web");
    vi.setSystemTime(NOW);

    const b = brief();
    expect(titles(b.stale)).toEqual(["Old and untouched", "Renew passport", "Old and plain"]);
    expect(titles(b.undated)).toEqual(["Added this week"]);
  });

  it("nudges a deadline-ish undated item that isn't stale yet", () => {
    const { add, brief } = board();
    vi.setSystemTime(at("2026-11-04"));
    add("Pay the window cleaner");
    add("Tidy the shed");
    vi.setSystemTime(NOW);
    expect(titles(brief().undated)).toEqual(["Pay the window cleaner"]);
  });
});
