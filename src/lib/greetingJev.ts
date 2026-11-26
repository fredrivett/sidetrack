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
  "week",
  "urgent",
  "heavy",
  "tidy",
  "wind-down",
  "clear",
  "lighten",
] as const;
export type Moment = (typeof MOMENTS)[number];

/** What each moment means, for Jev and for the writer. */
export const MOMENT_MEANING: Record<Moment, string> = {
  plan: "Help the reader plan today: name what's due today and where to start.",
  triage: "Gently raise items that slipped past their day, offering to give them new days. Never scold.",
  week: "Nothing is open today, so name what is still open this week (due this week, or on a day still to come), so the week's tasks aren't forgotten.",
  urgent: "Nudge an undated item that reads as time-sensitive (a renewal, a bill, a booking).",
  heavy: "Point out a day ahead that is much busier than the others, so they can get ahead.",
  tidy: "Suggest picking up an undated item that has sat untouched for weeks. Only when today is light and nothing has slipped.",
  "wind-down": "Close the day: what's left can wait until tomorrow. No planning, no looking ahead.",
  clear: "Today is done or empty: say so warmly and briefly.",
  lighten:
    "The reader's note for today asks for a lighter day (unwell, tired, short on time): offer to move today's tasks to tomorrow. Only when the note says so.",
};

/** At most this many items from each moment's pool are scored or shown to Jev. */
export const POOL_CAP = 5;
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
 * A day with nothing open always names the week's open items: "nothing due
 * today" alone reads as nothing to do (STF-1).
 */
const ALWAYS: Moment[] = ["triage", "week", "wind-down"];

const openToday = (brief: AgendaBrief) => brief.dueToday.filter((i) => i.completedAt === null);

/**
 * The day in the next week that stands out as busy: at least three open items
 * and at least twice the median of the other days. Null when none does.
 */
export function heavyDay(brief: AgendaBrief): { day: string; open: number } | null {
  const week = brief.ahead.slice(0, 7);
  if (week.length === 0) return null;
  const busiest = week.reduce((b, d) => (d.open > b.open ? d : b));
  const rest = week.filter((d) => d !== busiest).map((d) => d.open).sort((a, b) => a - b);
  const median = rest.length ? rest[Math.floor(rest.length / 2)] : 0;
  return busiest.open >= 3 && busiest.open >= 2 * median ? busiest : null;
}

/** The moments that can apply to `brief`; the rest aren't asked about. */
export function possibleMoments(brief: AgendaBrief): Moment[] {
  const open = openToday(brief);
  const evening = brief.partOfDay === "evening";
  const m: Moment[] = [];
  if (!evening && open.length > 0) m.push("plan");
  if (brief.overdue.length > 0) m.push("triage");
  if (!evening && open.length === 0 && brief.thisWeek.length > 0) m.push("week");
  if (!evening && brief.undated.length > 0) m.push("urgent");
  if (!evening && heavyDay(brief)) m.push("heavy");
  if (!evening && brief.stale.length > 0 && brief.overdue.length === 0 && open.length <= 1) {
    m.push("tidy");
  }
  // An evening with something open winds down; one with nothing open is clear.
  if (evening && open.length > 0) m.push("wind-down");
  if (open.length === 0) m.push("clear");
  if (!evening && open.length > 0 && brief.dayNote) m.push("lighten");
  return m;
}

/**
 * Which items each moment may name, POOL_CAP at most. A lighter day names
 * none: its offer lists every one of today's, for the reader to choose.
 */
function pool(brief: AgendaBrief, m: Moment): BriefItem[] {
  const all =
    m === "plan" || m === "wind-down"
      ? openToday(brief)
      : m === "triage"
        ? brief.overdue
        : m === "week"
          ? brief.thisWeek
          : m === "urgent"
            ? brief.undated
            : m === "tidy"
              ? brief.stale
              : [];
  return all.slice(0, POOL_CAP);
}

/** The items worth scoring: those a possible moment could name. */
export function candidates(brief: AgendaBrief): BriefItem[] {
  const byId = new Map<string, BriefItem>();
  for (const m of possibleMoments(brief)) for (const i of pool(brief, m)) byId.set(i.id, i);
  return [...byId.values()];
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

const STATE_CAP = 15;

/** The brief as Jev reads it: facts only, item text as data. */
export function jevState(brief: AgendaBrief) {
  return {
    today: brief.today,
    weekday: brief.weekday,
    weekend: brief.weekend,
    part_of_day: brief.partOfDay,
    finished_since_last_visit: brief.lookBack.finishedCount,
    // Capped, so a long backlog doesn't grow the request without bound.
    due_today: brief.dueToday
      .slice(0, STATE_CAP)
      .map((i) => ({ ...describe(i), done: i.completedAt !== null })),
    slipped: brief.overdue.slice(0, STATE_CAP).map(describe),
    slipped_count: brief.overdue.length,
    open_this_week: brief.thisWeek.slice(0, STATE_CAP).map(describe),
    open_this_week_count: brief.thisWeek.length,
    open_per_day_ahead: brief.ahead.slice(0, 7),
    undated_recent_or_deadline: brief.undated.slice(0, STATE_CAP).map(describe),
    undated_untouched_for_weeks: brief.stale.slice(0, STATE_CAP).map(describe),
    // The reader's own words about today: data, like titles.
    ...(brief.dayNote && { reader_note_for_today: brief.dayNote }),
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
  fetchImpl: typeof fetch,
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
  /** At most two (one for a short greeting), highest first; empty means a quiet one-liner. */
  moments: Moment[];
  /** Per picked moment, at most two items to name, highest first. */
  items: Partial<Record<Moment, BriefItem[]>>;
  /** No date items the reader can open as "N others", by score, highest first. */
  others: BriefItem[];
  /** The busy day ahead, when "heavy" is picked. */
  heavyDay: { day: string; open: number } | null;
  /** Every moment Jev was asked about, and why it was or wasn't said. */
  considered: Array<{ moment: Moment; score: number; said: boolean; why: string }>;
}

/** The moments and items to say, from Jev's scores: `most` moments at most (the reader's length). */
export function pickGreeting(brief: AgendaBrief, scores: GreetingScores, most = 2): GreetingPick {
  const score = (i: BriefItem) => scores.items[i.id] ?? 0;
  const byScore = (list: BriefItem[]) => [...list].sort((a, b) => score(b) - score(a));
  const asked = Object.keys(scores.moments) as Moment[];
  const always = ALWAYS.filter((m) => asked.includes(m));
  const optional = (Object.entries(scores.moments) as Array<[Moment, number]>)
    .filter(([m, p]) => !ALWAYS.includes(m) && p >= MOMENT_THRESHOLD)
    .sort((a, b) => b[1] - a[1])
    .map(([m]) => m);
  // A moment about items needs an item worth naming, or it isn't said and
  // the next moment takes its place.
  const moments: Moment[] = [];
  const items: GreetingPick["items"] = {};
  const named = new Set<string>();
  const why = new Map<Moment, string>();
  for (const m of [...always, ...optional]) {
    if (moments.length >= most) {
      why.set(m, most === 1 ? "One thing was already being said" : "Two things were already being said");
      continue;
    }
    const undated = m === "urgent" || m === "tidy";
    const picks = byScore(pool(brief, m))
      .filter((i) => !undated || score(i) >= UNDATED_ITEM_THRESHOLD)
      .slice(0, 2);
    if (picks.length === 0 && m !== "heavy" && m !== "clear" && m !== "lighten") {
      why.set(m, `No item scored ${UNDATED_ITEM_THRESHOLD} or more to name`);
      continue;
    }
    moments.push(m);
    why.set(m, ALWAYS.includes(m) ? "Always said when it applies" : `Scored ${MOMENT_THRESHOLD} or more`);
    picks.forEach((i) => named.add(i.id));
    if (picks.length > 0) items[m] = picks;
  }
  const considered = asked
    .map((m) => ({
      moment: m,
      score: scores.moments[m] ?? 0,
      said: moments.includes(m),
      why: why.get(m) ?? `Scored under ${MOMENT_THRESHOLD}`,
    }))
    .sort((a, b) => Number(b.said) - Number(a.said) || b.score - a.score);
  // The undated items not named, so the reader can open the rest.
  const undated = new Map([...brief.undated, ...brief.stale].map((i) => [i.id, i]));
  const others = moments.some((m) => m === "urgent" || m === "tidy")
    ? byScore([...undated.values()].filter((i) => !named.has(i.id)))
    : [];
  return {
    moments,
    items,
    others,
    heavyDay: moments.includes("heavy") ? heavyDay(brief) : null,
    considered,
  };
}
