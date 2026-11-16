import { describe, expect, it } from "vitest";
import { type ItemFilters, matchesFilters, NO_FILTERS, parseItemFilters, shownInGroups } from "./filters";

// Saturday 14 November 2026: this week is 9–15 Nov, next week 16–22 Nov.
const today = "2026-11-14";
const f = (more: Partial<ItemFilters>): ItemFilters => ({ ...NO_FILTERS, ...more });
const it_ = (
  dueDate: string | null,
  dueFrom: string | null = null,
  assigneeIds: string[] = [],
  labels: string[] = [],
) => ({ assigneeIds, labels, dueDate, dueFrom });

describe("matchesFilters", () => {
  it("matches any person picked, or nobody's with No assignee", () => {
    const people = f({ assignees: ["ann"], unassigned: true });
    expect(matchesFilters(it_(null, null, ["bob", "ann"]), undefined, people, today)).toBe(true);
    expect(matchesFilters(it_(null, null, []), undefined, people, today)).toBe(true);
    expect(matchesFilters(it_(null, null, ["bob"]), undefined, people, today)).toBe(false);
    // Only "No assignee": assigned items go.
    expect(matchesFilters(it_(null, null, ["ann"]), undefined, f({ unassigned: true }), today)).toBe(false);
  });

  it("matches any label picked, or none with No labels, a sub-item by its parent's", () => {
    const work = f({ labels: ["work"], unlabelled: true });
    const item = (...labels: string[]) => it_(null, null, [], labels);
    expect(matchesFilters(item("home", "work"), undefined, work, today)).toBe(true);
    expect(matchesFilters(item(), undefined, work, today)).toBe(true);
    expect(matchesFilters(item("home"), undefined, work, today)).toBe(false);
    const onlyWork = f({ labels: ["work"] });
    // An unlabelled sub-item goes with its parent's labels; its own win.
    expect(matchesFilters(item(), item("work"), onlyWork, today)).toBe(true);
    expect(matchesFilters(item("home"), item("work"), onlyWork, today)).toBe(false);
    expect(matchesFilters(item(), item("work"), f({ unlabelled: true }), today)).toBe(false);
  });

  it("matches a span by any day in it, and This week from today on", () => {
    // Started last week, ends Monday: overlaps next week, not today.
    const span = it_("2026-11-16", "2026-11-12");
    expect(matchesFilters(span, undefined, f({ due: ["next-week"] }), today)).toBe(true);
    expect(matchesFilters(span, undefined, f({ due: ["today"] }), today)).toBe(true);
    expect(matchesFilters(span, undefined, f({ due: ["overdue"] }), today)).toBe(false);
    // Due Tuesday this week has passed: Overdue, not This week.
    const tue = it_("2026-11-10");
    expect(matchesFilters(tue, undefined, f({ due: ["this-week"] }), today)).toBe(false);
    expect(matchesFilters(tue, undefined, f({ due: ["overdue"] }), today)).toBe(true);
    expect(matchesFilters(it_("2026-11-15"), undefined, f({ due: ["this-week"] }), today)).toBe(true);
    expect(matchesFilters(it_("2026-11-23"), undefined, f({ due: ["next-week"] }), today)).toBe(false);
  });

  it("matches either a quick choice or the date range, inclusive", () => {
    const filters = f({ due: ["none"], dueRange: { from: "2026-11-20", to: "2026-11-25" } });
    expect(matchesFilters(it_(null), undefined, filters, today)).toBe(true);
    expect(matchesFilters(it_("2026-11-25"), undefined, filters, today)).toBe(true);
    expect(matchesFilters(it_("2026-11-26"), undefined, filters, today)).toBe(false);
    expect(matchesFilters(it_("2026-11-30", "2026-11-19"), undefined, filters, today)).toBe(true);
  });

  it("dates an undated sub-item by its parent, and waits for today", () => {
    const dueToday = f({ due: ["today"] });
    expect(matchesFilters(it_(null), it_(today), dueToday, today)).toBe(true);
    expect(matchesFilters(it_(null), it_(today), f({ due: ["none"] }), today)).toBe(false);
    // Its own date wins over its parent's.
    expect(matchesFilters(it_("2026-11-20"), it_(today), dueToday, today)).toBe(false);
    expect(matchesFilters(it_(today), undefined, dueToday, null)).toBe(false);
    expect(matchesFilters(it_(today), undefined, NO_FILTERS, null)).toBe(true);
  });
});

describe("shownInGroups", () => {
  it("keeps a parent for a matching sub-item, and not its other sub-items", () => {
    type Row = { id: string; mine: boolean };
    const groups: Array<Row & { children: Row[] }> = [
      { id: "p", mine: false, children: [{ id: "a", mine: true }, { id: "b", mine: false }] },
      { id: "q", mine: false, children: [{ id: "c", mine: false }] },
      { id: "r", mine: true, children: [] },
    ];
    const shown = shownInGroups(groups, (i) => i.mine);
    expect([...shown].sort()).toEqual(["a", "p", "r"]);
  });
});

describe("parseItemFilters", () => {
  it("falls back to none for missing or broken saved filters", () => {
    expect(parseItemFilters(null)).toEqual(NO_FILTERS);
    expect(parseItemFilters({ ...NO_FILTERS, due: ["someday"] })).toEqual(NO_FILTERS);
    expect(parseItemFilters({ ...NO_FILTERS, dueRange: { from: "2026-11-20", to: "2026-11-01" } })).toEqual(
      NO_FILTERS,
    );
    const kept = f({ assignees: ["ann"], doneToday: false });
    expect(parseItemFilters(kept)).toEqual(kept);
  });
});
