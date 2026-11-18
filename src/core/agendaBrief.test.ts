import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAgendaBrief } from "./agendaBrief";
import { addItem, completeItem } from "./items";
import { acceptInvite, inviteMember } from "./members";
import { createProject } from "./projects";
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

function board() {
  const { db } = createTestDb();
  const fred = createTestUser(db, { username: "fred" });
  const sam = createTestUser(db, { username: "sam" });
  const home = createProject(db, fred, { name: "Home" }, "web");
  inviteMember(db, fred, home.id, "sam", "web");
  acceptInvite(db, sam, home.id, "web");
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
  it("counts the viewer's and unassigned items, and steps only under a parent that's theirs too", () => {
    const { fred, sam, add, brief } = board();
    const today = "2026-11-18";
    add("Fred's", { dueDate: today, assigneeIds: [fred] });
    add("Nobody's", { dueDate: today });
    const samsParent = add("Sam's", { dueDate: today, assigneeIds: [sam] });
    add("Loose step under Sam's", { dueDate: today, parentId: samsParent.id });
    add("Fred's step under Sam's", { dueDate: today, parentId: samsParent.id, assigneeIds: [fred] });
    const shared = add("Nobody's with steps", { dueDate: today });
    add("Step one", { parentId: shared.id });
    add("Step two", { parentId: shared.id, assigneeIds: [sam] });

    const b = brief();
    expect(titles(b.dueToday)).toEqual([
      "Fred's",
      "Nobody's",
      "Fred's step under Sam's",
      "Nobody's with steps",
    ]);
    // Sam's step isn't Fred's to count.
    expect(b.dueToday.find((i) => i.title === "Nobody's with steps")?.stepsLeft).toBe(1);
    expect(b.dueToday.find((i) => i.title === "Fred's step under Sam's")?.parent).toBe("Sam's");
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
    const { db, fred, sam, add, brief } = board();
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
    // Newest first; the step went with its parent.
    expect(titles(b.lookBack.finished)).toEqual(["Parent with a step", "Done since"]);
    // Monday's was due on the day of the read, so it slipped after it; last
    // week's was already late.
    expect(titles(b.lookBack.slipped)).toEqual(["Due Tuesday", "Due Monday"]);
    expect(titles(b.overdue)).toEqual(["Due Monday", "Due Tuesday", "Due last week"]);

    // No read yet: nothing to look back on.
    expect(brief().lookBack).toEqual({ finished: [], slipped: [] });
  });

  it("caps the look-back at the ten newest, however long the viewer was away", () => {
    const { db, fred, add, brief } = board();
    for (let d = 1; d <= 12; d++) {
      const day = `2026-11-${String(d).padStart(2, "0")}`;
      const item = add(`Done on ${day}`);
      vi.setSystemTime(at(day));
      completeItem(db, fred, item.id, "web");
      vi.setSystemTime(NOW);
    }
    add("Slipped yesterday", { dueDate: "2026-11-17" });
    const b = brief({ since: at("2026-10-01") });
    expect(titles(b.lookBack.slipped)).toEqual(["Slipped yesterday"]);
    expect(b.lookBack.finished).toHaveLength(9);
    expect(b.lookBack.finished[0].title).toBe("Done on 2026-11-12");
    expect(b.lookBack.finished.at(-1)?.title).toBe("Done on 2026-11-04");
  });

  it("counts single days ahead to the end of next week, and keeps spans apart", () => {
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
    // Only the span under way.
    expect(titles(b.spans)).toEqual(["This week"]);
  });

  it("finds stale undated items by their last change, and recent or deadline-ish ones to nudge", () => {
    const { add, brief } = board();
    vi.setSystemTime(at("2026-10-01"));
    add("Old and untouched");
    const busy = add("Old but its checklist grew");
    add("Renew passport");
    add("Old and plain");
    vi.setSystemTime(at("2026-11-16"));
    add("A step added this week", { parentId: busy.id });
    add("Added this week");
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
