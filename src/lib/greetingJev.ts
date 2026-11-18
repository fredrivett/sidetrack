// Jev's editorial calls for the Agenda greeting: which moments are worth
// saying now, and which items are worth naming. One request per greeting,
// as jev.ts recommends: the brief is the state, and each moment and each
// candidate item gets its own noul, so two good moments don't split one
// score. Moments that can't apply are left out in code before asking.
// Framework-agnostic: no DB access.

import type { AgendaBrief, BriefItem } from "../core/agendaBrief";
import { askJev, type NoulQuestion } from "./jev";

export const MOMENTS = [
  "plan",
  "triage",
  "urgent",
  "heavy",
  "tidy",
  "wind-down",
  "clear",
] as const;
export type Moment = (typeof MOMENTS)[number];

/** What each moment means, for Jev and for the writer. */
export const MOMENT_MEANING: Record<Moment, string> = {
  plan: "Help the reader plan today: name what's due today and where to start.",
  triage: "Gently raise items that slipped past their day, offering to give them new days. Never scold.",
  urgent: "Nudge an undated item that reads as time-sensitive (a renewal, a bill, a booking).",
  heavy: "Point out a day ahead that is much busier than the others, so they can get ahead.",
  tidy: "Suggest picking up an undated item that has sat untouched for weeks. Only when today is light and nothing has slipped.",
  "wind-down": "Close the day: what's left can wait until tomorrow. No planning, no looking ahead.",
  clear: "Today is done or empty: say so warmly and briefly.",
};

/** At most this many items are scored; more costs more and helps little. */
export const MAX_CANDIDATES = 15;
/**
 * An optional moment needs this score to be said. Live scores bunch between
 * about 0.7 and 0.9, so this only drops the weak ones; ranking does the rest.
 */
export const MOMENT_THRESHOLD = 0.6;
/** An undated item needs this score to be named; live scores for chores sit near 0.25. */
export const UNDATED_ITEM_THRESHOLD = 0.3;
/**
 * Moments said whenever they apply, whatever Jev scores: the evening always
 * winds down, and what slipped is always raised (gently) before anything
 * else. Measured live, Jev ranked planning above slipped items and scored
 * winding down at 0.32, which would leave an evening with nothing to say.
 */
const ALWAYS: Moment[] = ["triage", "wind-down"];

/** The moments that can apply to `brief`; the rest aren't asked about. */
export function possibleMoments(brief: AgendaBrief): Moment[] {
  const open = brief.dueToday.filter((i) => i.completedAt === null);
  const evening = brief.partOfDay === "evening";
  const m: Moment[] = [];
  if (!evening && open.length > 0) m.push("plan");
  if (brief.overdue.length > 0) m.push("triage");
  if (!evening && brief.undated.length > 0) m.push("urgent");
  if (!evening && brief.ahead.slice(0, 7).some((d) => d.open >= 3)) m.push("heavy");
  if (!evening && brief.stale.length > 0 && brief.overdue.length === 0 && open.length <= 1) {
    m.push("tidy");
  }
  if (evening) m.push("wind-down");
  if (open.length === 0) m.push("clear");
  return m;
}

/** The items worth scoring: today's, what slipped, then undated, without repeats. */
export function candidates(brief: AgendaBrief): BriefItem[] {
  const seen = new Set<string>();
  const out: BriefItem[] = [];
  for (const i of [
    ...brief.overdue,
    ...brief.dueToday.filter((d) => d.completedAt === null),
    ...brief.undated,
    ...brief.stale,
  ]) {
    if (seen.has(i.id) || out.length >= MAX_CANDIDATES) continue;
    seen.add(i.id);
    out.push(i);
  }
  return out;
}

const describe = (i: BriefItem) => ({
  ref: i.ref,
  title: i.title,
  list: i.list,
  ...(i.parent && { under: i.parent }),
  ...(i.dueDate && { due: i.dueDate }),
  ...(i.dueFrom && { due_from: i.dueFrom }),
  ...(i.repeats && { repeats: true }),
  ...(i.stepsLeft > 0 && { steps_left: i.stepsLeft }),
});

/** The brief as Jev reads it: facts only, item text as data. */
export function jevState(brief: AgendaBrief) {
  return {
    today: brief.today,
    weekday: brief.weekday,
    weekend: brief.weekend,
    part_of_day: brief.partOfDay,
    finished_since_last_visit: brief.lookBack.finishedCount,
    due_today: brief.dueToday.map((i) => ({ ...describe(i), done: i.completedAt !== null })),
    slipped: brief.overdue.map(describe),
    open_per_day_ahead: brief.ahead.slice(0, 7),
    undated_recent_or_deadline: brief.undated.map(describe),
    undated_untouched_for_weeks: brief.stale.map(describe),
  };
}

export interface GreetingScores {
  moments: Partial<Record<Moment, number>>;
  items: Record<string, number>;
}

/**
 * Jev's scores for `brief`'s possible moments and candidate items. Null when
 * the request fails or leaves a question unanswered, so the caller falls back
 * to the templates. `fetchImpl` is injectable for tests.
 */
export async function scoreGreeting(
  brief: AgendaBrief,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GreetingScores | null> {
  const moments = possibleMoments(brief);
  const items = candidates(brief);
  const questions: Record<string, NoulQuestion> = {};
  for (const m of moments) {
    questions[`moment:${m}`] = {
      type: "noul",
      instructions: {
        greeting_move: MOMENT_MEANING[m],
        question:
          "A calm assistant greets this person on their to-do list in two or three sentences. Is this one of the things most worth saying right now, given the time, the day of the week and their list?",
      },
    };
  }
  for (const i of items) {
    questions[`item:${i.id}`] = {
      type: "noul",
      instructions: {
        task: describe(i),
        question:
          "Is this task worth naming in a short, calm greeting right now: the thing this person would most want to be reminded of today?",
      },
    };
  }
  if (Object.keys(questions).length === 0) return { moments: {}, items: {} };
  const answers = await askJev(jevState(brief), questions, apiKey, fetchImpl);
  if (!answers) return null;
  const scores: GreetingScores = { moments: {}, items: {} };
  for (const m of moments) {
    const p = answers[`moment:${m}`]?.true;
    if (p === undefined) return null;
    scores.moments[m] = p;
  }
  for (const i of items) {
    const p = answers[`item:${i.id}`]?.true;
    if (p === undefined) return null;
    scores.items[i.id] = p;
  }
  return scores;
}

export interface GreetingPick {
  /** At most two, highest first; empty means a quiet one-liner. */
  moments: Moment[];
  /** Per picked moment, at most two items to name, highest first. */
  items: Partial<Record<Moment, BriefItem[]>>;
  /** No date items the reader can open as "N others", by score, highest first. */
  others: BriefItem[];
}

/** Which items each moment may name. */
function pool(brief: AgendaBrief, m: Moment): BriefItem[] {
  switch (m) {
    case "plan":
    case "wind-down":
      return brief.dueToday.filter((i) => i.completedAt === null);
    case "triage":
      return brief.overdue;
    case "urgent":
      return brief.undated;
    case "tidy":
      return brief.stale;
    default:
      return [];
  }
}

/** The moments and items to say, from Jev's scores. */
export function pickGreeting(brief: AgendaBrief, scores: GreetingScores): GreetingPick {
  const score = (i: BriefItem) => scores.items[i.id] ?? 0;
  const byScore = (list: BriefItem[]) => [...list].sort((a, b) => score(b) - score(a));
  const asked = Object.keys(scores.moments) as Moment[];
  const always = ALWAYS.filter((m) => asked.includes(m));
  const optional = (Object.entries(scores.moments) as Array<[Moment, number]>)
    .filter(([m, p]) => !ALWAYS.includes(m) && p >= MOMENT_THRESHOLD)
    .sort((a, b) => b[1] - a[1])
    .map(([m]) => m);
  const moments = [...always, ...optional].slice(0, 2);
  const items: GreetingPick["items"] = {};
  const named = new Set<string>();
  for (const m of moments) {
    const undated = m === "urgent" || m === "tidy";
    const picks = byScore(pool(brief, m))
      .filter((i) => !named.has(i.id))
      .filter((i) => !undated || score(i) >= UNDATED_ITEM_THRESHOLD)
      .slice(0, 2);
    picks.forEach((i) => named.add(i.id));
    if (picks.length > 0) items[m] = picks;
  }
  // The undated items not named, so the reader can open the rest.
  const undated = new Map([...brief.undated, ...brief.stale].map((i) => [i.id, i]));
  const others = moments.some((m) => m === "urgent" || m === "tidy")
    ? byScore([...undated.values()].filter((i) => !named.has(i.id)))
    : [];
  return { moments, items, others };
}
