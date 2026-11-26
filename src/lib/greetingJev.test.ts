import { describe, expect, it } from "vitest";
import type { AgendaBrief, BriefItem } from "../core/agendaBrief";
import { candidates, heavyDay, pickGreeting, possibleMoments, scoreGreeting } from "./greetingJev";

const item = (id: string, more: Partial<BriefItem> = {}): BriefItem => ({
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

const days = (open: number[]) => open.map((n, i) => ({ day: `2026-11-${19 + i}`, open: n }));

const brief = (more: Partial<AgendaBrief> = {}): AgendaBrief => ({
  today: "2026-11-18",
  weekday: "Wednesday",
  weekend: false,
  partOfDay: "morning",
  since: null,
  sinceDay: null,
  lookBack: { finished: [], finishedCount: 0, slipped: [] },
  dueToday: [],
  doneToday: 0,
  overdue: [],
  ahead: Array.from({ length: 11 }, (_, i) => ({ day: `2026-11-${19 + i}`, open: 0 })),
  thisWeek: [],
  undated: [],
  stale: [],
  dayNote: null,
  closed: null,
  lastNight: null,
  ...more,
});

/** A fetch that records the questions asked and answers each noul with `p(id)`. */
function fakeJev(p: (id: string) => number | undefined) {
  const asked: string[] = [];
  const impl = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { questions: Record<string, unknown> };
    asked.push(...Object.keys(body.questions));
    const answers = Object.fromEntries(
      Object.keys(body.questions)
        .filter((id) => p(id) !== undefined)
        .map((id) => [id, { noul: p(id) }]),
    );
    return new Response(JSON.stringify({ answers }));
  }) as unknown as typeof fetch;
  return { asked, impl };
}

describe("possibleMoments", () => {
  it("asks only about moments that can apply", () => {
    expect(possibleMoments(brief({ dueToday: [item("a")] }))).toEqual(["plan"]);
    // Evening never plans or looks ahead; it winds down, or is clear with nothing open.
    expect(
      possibleMoments(brief({ partOfDay: "evening", dueToday: [item("a")], undated: [item("u")] })),
    ).toEqual(["wind-down"]);
    expect(possibleMoments(brief({ partOfDay: "evening" }))).toEqual(["clear"]);
    // Once it's closed, it only says goodnight, whatever's left and whenever it was closed.
    const closed = { mood: ["Good day"], words: null };
    expect(
      possibleMoments(brief({ closed, dueToday: [item("a")], overdue: [item("o")] })),
    ).toEqual(["goodnight"]);
    // Tidying waits for a light day with nothing slipped.
    expect(possibleMoments(brief({ stale: [item("s")], overdue: [item("o")] }))).toEqual([
      "triage",
      "clear",
    ]);
    expect(possibleMoments(brief({ stale: [item("s")] }))).toEqual(["tidy", "clear"]);
    // The week's open items come up on a day with nothing open, not in the
    // evening, and not when today has its own to plan.
    const week = { thisWeek: [item("w", { dueFrom: "2026-11-16", dueDate: "2026-11-22" })] };
    expect(possibleMoments(brief(week))).toEqual(["week", "clear"]);
    expect(possibleMoments(brief({ ...week, dueToday: [item("a", { completedAt: 1 })] }))).toEqual([
      "week",
      "clear",
    ]);
    expect(possibleMoments(brief({ ...week, partOfDay: "evening" }))).toEqual(["clear"]);
    expect(possibleMoments(brief({ ...week, dueToday: [item("a")] }))).toEqual(["plan"]);
  });

  it("offers a lighter day only with a note and something open today, before the evening", () => {
    const tired = { dayNote: "Not feeling well" };
    expect(possibleMoments(brief({ ...tired, dueToday: [item("a")] }))).toEqual(["plan", "lighten"]);
    expect(possibleMoments(brief({ dueToday: [item("a")] }))).not.toContain("lighten");
    expect(possibleMoments(brief({ ...tired, dueToday: [item("a", { completedAt: 1 })] }))).toEqual(["clear"]);
    expect(
      possibleMoments(brief({ ...tired, partOfDay: "evening", dueToday: [item("a")] })),
    ).toEqual(["wind-down"]);
  });
});

describe("heavyDay", () => {
  it("finds a day well above the rest, not just a busy week", () => {
    expect(heavyDay(brief({ ahead: days([1, 0, 5, 1, 0, 0, 1]) }))).toEqual({ day: "2026-11-21", open: 5 });
    expect(heavyDay(brief({ ahead: days([3, 4, 3, 4, 3, 3, 3]) }))).toBeNull();
    expect(heavyDay(brief({ ahead: days([0, 2, 0, 0, 0, 0, 0]) }))).toBeNull();
  });
});

describe("candidates", () => {
  it("scores a few from each moment's pool, so a long backlog can't crowd the rest out", () => {
    const b = brief({
      overdue: Array.from({ length: 20 }, (_, i) => item(`o${i}`)),
      undated: [item("u")],
      stale: [item("s")],
    });
    const ids = candidates(b).map((i) => i.id);
    expect(ids).toHaveLength(6);
    expect(ids).toContain("u");
    // Tidying can't apply with something slipped, so its pool isn't scored.
    expect(ids).not.toContain("s");
  });
});

describe("scoreGreeting", () => {
  it("asks one question per possible moment and candidate, and reads back each score", async () => {
    const b = brief({ overdue: [item("late")], undated: [item("renew")] });
    const p: Record<string, number> = { "moment:triage": 0.9, "item:late": 0.7, "item:renew": 0.35 };
    const { asked, impl } = fakeJev((id) => p[id] ?? 0.2);
    const scores = await scoreGreeting(b, "key", impl);
    expect(asked.sort()).toEqual(
      ["moment:triage", "moment:urgent", "moment:clear", "item:late", "item:renew"].sort(),
    );
    expect(scores).toEqual({
      moments: { triage: 0.9, urgent: 0.2, clear: 0.2 },
      items: { late: 0.7, renew: 0.35 },
    });
  });

  it("gives up when any question goes unanswered", async () => {
    const b = brief({ dueToday: [item("a")] });
    const { impl } = fakeJev((id) => (id === "item:a" ? undefined : 0.9));
    expect(await scoreGreeting(b, "key", impl)).toBeNull();
  });
});

describe("pickGreeting", () => {
  it("always raises what slipped first, then the strongest other moment, naming each one's best items once", () => {
    const b = brief({
      dueToday: [item("a"), item("b"), item("c")],
      overdue: [item("late")],
      undated: [item("u1"), item("u2"), item("u3")],
    });
    const pick = pickGreeting(b, {
      // As measured live: triage scored below planning.
      moments: { plan: 0.87, triage: 0.4, urgent: 0.55 },
      items: { a: 0.1, b: 0.8, c: 0.5, u1: 0.3, u2: 0.9, u3: 0.6, late: 0.99 },
    });
    expect(pick.moments).toEqual(["triage", "plan"]);
    expect(pick.items.triage?.map((i) => i.id)).toEqual(["late"]);
    expect(pick.items.plan?.map((i) => i.id)).toEqual(["b", "c"]);
    // Urgent was under the threshold, so no others to open.
    expect(pick.others).toEqual([]);
  });

  it("names only undated items that score enough, and offers the rest as others", () => {
    const b = brief({ undated: [item("passport"), item("plants")], stale: [item("loft")] });
    const pick = pickGreeting(b, {
      moments: { urgent: 0.77, tidy: 0.5, clear: 0.62 },
      items: { passport: 0.36, plants: 0.24, loft: 0.27 },
    });
    expect(pick.moments).toEqual(["urgent", "clear"]);
    expect(pick.items.urgent?.map((i) => i.id)).toEqual(["passport"]);
    expect(pick.others.map((i) => i.id)).toEqual(["loft", "plants"]);
  });

  it("always winds down in the evening, however Jev scores it", () => {
    const pick = pickGreeting(brief({ partOfDay: "evening", dueToday: [item("a")] }), {
      moments: { "wind-down": 0.32 },
      items: { a: 0.81 },
    });
    expect(pick.moments).toEqual(["wind-down"]);
    expect(pick.items["wind-down"]?.map((i) => i.id)).toEqual(["a"]);
  });

  // STF-1: "nothing due today" alone, with tasks open this week, read as nothing to do.
  it("always names what's left this week on a day with nothing open, however Jev scores it", () => {
    const b = brief({
      thisWeek: [item("span", { dueFrom: "2026-11-16", dueDate: "2026-11-22" }), item("fri"), item("sat")],
      undated: [item("u")],
    });
    const pick = pickGreeting(b, {
      moments: { week: 0.2, urgent: 0.9, clear: 0.8 },
      items: { span: 0.4, fri: 0.7, sat: 0.1, u: 0.9 },
    });
    expect(pick.moments).toEqual(["week", "urgent"]);
    expect(pick.items.week?.map((i) => i.id)).toEqual(["fri", "span"]);
  });

  it("says one thing for a short greeting", () => {
    const b = brief({ overdue: [item("late")], thisWeek: [item("fri")] });
    const pick = pickGreeting(b, { moments: { triage: 0.9, week: 0.9 }, items: { late: 0.9, fri: 0.9 } }, 1);
    expect(pick.moments).toEqual(["triage"]);
    expect(pick.considered.find((c) => c.moment === "week")?.why).toBe("One thing was already being said");
  });

  it("skips a moment with nothing worth naming, letting the next one speak", () => {
    const b = brief({ undated: [item("plants")], ahead: days([0, 0, 6, 0, 1, 0, 0]) });
    const pick = pickGreeting(b, {
      moments: { urgent: 0.85, heavy: 0.7, clear: 0.65 },
      items: { plants: 0.25 },
    });
    expect(pick.moments).toEqual(["heavy", "clear"]);
    expect(pick.heavyDay).toEqual({ day: "2026-11-21", open: 6 });
    expect(pick.others).toEqual([]);
  });

  it("says why each moment was or wasn't said", () => {
    const pick = pickGreeting(
      brief({
        dueToday: [item("a")],
        overdue: [item("o")],
        undated: [item("u")],
        ahead: Array.from({ length: 7 }, (_, i) => ({ day: `2026-11-${19 + i}`, open: i === 1 ? 6 : 1 })),
      }),
      { moments: { triage: 0.3, plan: 0.9, heavy: 0.8, urgent: 0.7 }, items: { a: 0.9, o: 0.9, u: 0.1 } },
    );
    expect(Object.fromEntries(pick.considered.map((c) => [c.moment, [c.said, c.why]]))).toEqual({
      triage: [true, "Always said when it applies"],
      plan: [true, "Scored 0.6 or more"],
      heavy: [false, "Two things were already being said"],
      urgent: [false, "Two things were already being said"],
    });
    // With room, an undated moment with nothing worth naming is left out for that.
    const room = pickGreeting(brief({ undated: [item("u")] }), {
      moments: { urgent: 0.7, clear: 0.2 },
      items: { u: 0.1 },
    });
    expect(room.considered).toEqual([
      { moment: "urgent", score: 0.7, said: false, why: "No item scored 0.3 or more to name" },
      { moment: "clear", score: 0.2, said: false, why: "Scored under 0.6" },
    ]);
  });

  it("is quiet when no moment is confident", () => {
    const pick = pickGreeting(brief({ dueToday: [item("a")] }), {
      moments: { plan: 0.55 },
      items: { a: 0.9 },
    });
    expect(pick).toEqual({
      moments: [],
      items: {},
      others: [],
      heavyDay: null,
      considered: [{ moment: "plan", score: 0.55, said: false, why: "Scored under 0.6" }],
    });
  });
});
