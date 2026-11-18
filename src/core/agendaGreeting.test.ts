import { describe, expect, it } from "vitest";
import type { AgendaBrief, BriefItem } from "./agendaBrief";
import { templateGreeting } from "./agendaGreeting";

const it_ = (id: string, more: Partial<BriefItem> = {}): BriefItem => ({
  id,
  ref: `HOM-${id}`,
  title: id,
  list: "Home",
  parent: null,
  dueDate: null,
  dueFrom: null,
  completedAt: null,
  repeats: false,
  stepsLeft: 0,
  ...more,
});

// Wednesday 18 November 2026; the ahead days run Thursday 19th to Sunday 29th.
const ahead = (busy: Record<string, number> = {}) =>
  Array.from({ length: 11 }, (_, i) => {
    const day = `2026-11-${19 + i}`;
    return { day, open: busy[day] ?? 0 };
  });

const brief = (more: Partial<AgendaBrief> = {}): AgendaBrief => ({
  today: "2026-11-18",
  weekday: "Wednesday",
  weekend: false,
  partOfDay: "morning",
  since: null,
  sinceDay: null,
  lookBack: { finished: [], finishedCount: 0, slipped: [] },
  dueToday: [],
  overdue: [],
  ahead: ahead(),
  spans: [],
  undated: [],
  stale: [],
  ...more,
});

describe("templateGreeting", () => {
  it("plans the morning, with warmth for what got done since yesterday", () => {
    const b = brief({
      sinceDay: "2026-11-17",
      lookBack: { finished: ["w", "x", "y", "z"].map((id) => it_(id)), finishedCount: 12, slipped: [] },
      dueToday: [it_("a"), it_("b"), it_("done", { completedAt: 1 })],
    });
    expect(templateGreeting(b, "Fred")).toBe(
      "Good morning, Fred. Since yesterday you've finished 12 — nice. A gentle Wednesday: {{item:a}} and {{item:b}} today.",
    );
  });

  it("names a lone finished item, by weekday after a few days away, and says nothing back after a same-day read", () => {
    const b = brief({
      sinceDay: "2026-11-13",
      lookBack: { finished: [it_("w")], finishedCount: 1, slipped: [] },
      dueToday: [it_("a")],
    });
    expect(templateGreeting(b, null)).toBe(
      "Good morning. Since Friday you've finished {{item:w}}. A gentle Wednesday: just {{item:a}} today.",
    );
    expect(templateGreeting({ ...b, sinceDay: "2026-11-18" }, null)).toBe(
      "Good morning. A gentle Wednesday: just {{item:a}} today.",
    );
  });

  it("offers to triage what slipped before anything else", () => {
    const one = brief({ overdue: [it_("late")], dueToday: [it_("a")] });
    expect(templateGreeting(one, "Fred")).toBe(
      "Good morning, Fred. {{item:late}} is still waiting. No rush — want to {{action:triage|give it a new day}}?",
    );
    const two = brief({ overdue: [it_("l1"), it_("l2")], partOfDay: "afternoon" });
    expect(templateGreeting(two, "Fred")).toBe(
      "Good afternoon, Fred. A few earlier things are still waiting. No rush — want to {{action:triage|give them new days}}, or let some go?",
    );
  });

  it("winds down in the evening without looking ahead or back", () => {
    const open = brief({
      partOfDay: "evening",
      sinceDay: "2026-11-17",
      lookBack: { finished: [it_("w"), it_("x"), it_("y")], finishedCount: 3, slipped: [] },
      overdue: [it_("late")],
      dueToday: [it_("a"), it_("b")],
    });
    expect(templateGreeting(open, "Fred")).toMatch(
      /^Evening, Fred\. Two things still open from today\. (They'll keep until tomorrow|Fine to leave them for tomorrow)\.$/,
    );
    const clear = brief({ partOfDay: "evening", dueToday: [it_("a", { completedAt: 1 })] });
    expect(templateGreeting(clear, "Fred")).toMatch(/^Evening, Fred\. .*Enjoy the (rest of the )?evening\.$/);
  });

  it("looks ahead to a day that stands out, naming next week's as next", () => {
    const b = brief({ ahead: ahead({ "2026-11-25": 5, "2026-11-20": 1 }) });
    expect(templateGreeting(b, "Fred")).toBe(
      "Good morning, Fred. Nothing due today. Next Wednesday looks busy, so maybe move one thing earlier?",
    );
    // Busy every day isn't a day that stands out.
    const even = brief({
      ahead: ahead(Object.fromEntries(ahead().map((d) => [d.day, 4]))),
      stale: [it_("s1"), it_("s2"), it_("s3")],
    });
    expect(templateGreeting(even, "Fred")).toBe(
      "Good morning, Fred. Nothing due today. Two things in No date have been sitting a while, if you feel like picking one up: {{item:s1}} and {{item:s2}}.",
    );
  });

  it("prefers a fresh nudge to a stale one, and is quiet when there's neither", () => {
    const b = brief({ undated: [it_("renew")], stale: [it_("old")] });
    expect(templateGreeting(b, null)).toBe(
      "Good morning. Nothing due today. {{item:renew}} might be worth a look, if you feel like picking something up.",
    );
    expect(templateGreeting(brief(), null)).toMatch(/^Good morning\. Nothing due today\. (A quiet Wednesday|Enjoy the quiet)\.$/);
  });

  it("never exclaims, never states a backlog total, and names only items from the brief", () => {
    const pool = Array.from({ length: 8 }, (_, i) => it_(`i${i}`));
    for (const partOfDay of ["morning", "afternoon", "evening"] as const) {
      for (const n of [0, 1, 2, 3, 6]) {
        for (const overdue of [0, 1, 4]) {
          const b = brief({
            partOfDay,
            sinceDay: "2026-11-16",
            dueToday: pool.slice(0, n),
            overdue: pool.slice(0, overdue),
            lookBack: { finished: pool.slice(0, n), finishedCount: n, slipped: [] },
            undated: pool.slice(5),
            stale: pool.slice(3),
          });
          const text = templateGreeting(b, "Fred");
          expect(text).not.toContain("!");
          expect(text).not.toMatch(/overdue|late\b/i);
          for (const [, id] of text.matchAll(/\{\{item:([^}]+)\}\}/g)) {
            expect(pool.map((i) => i.id)).toContain(id);
          }
        }
      }
    }
  });
});
