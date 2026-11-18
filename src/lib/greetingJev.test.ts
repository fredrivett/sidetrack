import { describe, expect, it } from "vitest";
import type { AgendaBrief, BriefItem } from "../core/agendaBrief";
import { pickGreeting, possibleMoments, scoreGreeting } from "./greetingJev";

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
  ahead: Array.from({ length: 11 }, (_, i) => ({ day: `2026-11-${19 + i}`, open: 0 })),
  spans: [],
  undated: [],
  stale: [],
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
    // Evening never plans or looks ahead; it winds down.
    expect(
      possibleMoments(brief({ partOfDay: "evening", dueToday: [item("a")], undated: [item("u")] })),
    ).toEqual(["wind-down"]);
    // Tidying waits for a light day with nothing slipped.
    expect(possibleMoments(brief({ stale: [item("s")], overdue: [item("o")] }))).toEqual([
      "triage",
      "clear",
    ]);
    expect(possibleMoments(brief({ stale: [item("s")] }))).toEqual(["tidy", "clear"]);
  });
});

describe("scoreGreeting", () => {
  it("asks one question per possible moment and candidate, and reads back each score", async () => {
    const b = brief({ overdue: [item("late")], undated: [item("renew")] });
    const { asked, impl } = fakeJev((id) => (id === "moment:triage" ? 0.9 : 0.2));
    const scores = await scoreGreeting(b, "key", impl);
    expect(asked.sort()).toEqual(
      ["moment:triage", "moment:urgent", "moment:clear", "item:late", "item:renew"].sort(),
    );
    expect(scores).toEqual({
      moments: { triage: 0.9, urgent: 0.2, clear: 0.2 },
      items: { late: 0.2, renew: 0.2 },
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
      moments: { plan: 0.87, triage: 0.4, urgent: 0.55, clear: 0.65 },
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

  it("is quiet when no moment is confident", () => {
    const pick = pickGreeting(brief({ dueToday: [item("a")] }), {
      moments: { plan: 0.55 },
      items: { a: 0.9 },
    });
    expect(pick).toEqual({ moments: [], items: {}, others: [] });
  });
});
