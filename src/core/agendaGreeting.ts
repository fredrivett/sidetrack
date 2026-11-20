// The Agenda greeting written from its brief by hand-picked rules: what shows
// when AI is off or the writer fails, and the first greeting the Agenda
// gets. It says one or two things, never the whole board, and never nags:
// no backlog totals, no streaks, nothing in red, no exclamation marks.
//
// Items are named by token, never by title, so the page can show each one
// as a chip that opens it: `{{item:<id>}}`. An action reads
// `{{action:<name>|<words>}}`, the words being what the reader taps.

import { and as both, eq, inArray } from "drizzle-orm";
import { type GreetingPick, type Moment, pickGreeting, scoreGreeting } from "../lib/greetingJev";
import { WRITER_MODEL, writeGreeting } from "../lib/greetingWriter";
import { addDays, dayOf } from "../lib/time";
import { type GreetingLength, type GreetingPrefs, LENGTH_LIMITS } from "../lib/greetingPrefs";
import { type AgendaBrief, type BriefItem, buildAgendaBrief, type PartOfDay } from "./agendaBrief";
import type { Db } from "./db";
import { hasProjectAccess } from "./access";
import { agendaGreetings, items, projects } from "./schema";
import { getAgendaReadAt, getGreetingPrefs, getProfile } from "./users";

/** A greeting to show: its opening line, then its text with tokens. */
export interface Greeting {
  /** "Good morning, Fred." */
  hello: string;
  text: string;
  /** By item id, for items the page may not have loaded. */
  titles: Record<string, string>;
  /** The undated items "{{others|…}}" opens, best first. */
  others: Array<{ id: string; title: string }>;
  /** Whether Claude wrote it, rather than the templates. */
  written: boolean;
  /** How it was worked out, for "What is this?". Absent on ones kept from before it was recorded. */
  trace?: GreetingTrace;
  /** Out of date, and may be written again in this many ms: when to ask again. */
  retryInMs?: number;
  /** The viewer's note for today (dayNotes.ts), as it is now; null or absent for none. */
  note?: string | null;
}

/** How a greeting was worked out: what it looked at and what it decided. */
export interface GreetingTrace {
  day: string;
  partOfDay: PartOfDay;
  /** When it was worked out, and the viewer's time zone then, to show it in. */
  at: number;
  timeZone: string;
  /** Why the built-in greeting shows instead of Claude's; null when it's Claude's. */
  why: string | null;
  /** What it read off the board, as counts. */
  looked: {
    dueToday: number;
    doneToday: number;
    slipped: number;
    /** Absent on ones kept from before it was counted. */
    thisWeek?: number;
    undated: number;
    stale: number;
    finishedSince: number;
    /** The day it looks back to, or null the first time. */
    sinceDay: string | null;
    /** Whether it read the viewer's note for today. Absent on ones from before notes. */
    dayNote?: boolean;
  };
  /** Each thing it could say, Jev's score and why it was or wasn't said; null before Jev. */
  moments: Array<{ moment: Moment; score: number; said: boolean; why: string }> | null;
  /** The items Jev weighed, its score for each, and what came of it; null before Jev. */
  items: Array<{ id: string; title: string; list: string; score: number; named: boolean; other: boolean }> | null;
  /** The model that wrote it, when one did. */
  model: string | null;
  /** The reader's settings it followed. Absent on ones from before they could choose. */
  prefs?: { length: GreetingLength; note: boolean };
}

/**
 * What agenda_greetings keeps: Claude's greeting, or a failed ask's trace
 * with no text; and, by item id, how each item it names stood when written
 * (stampOf), so a change to one has it written again. Absent on older rows.
 */
export type StoredGreeting = Omit<Greeting, "hello" | "written" | "note"> & {
  stamps?: Record<string, string>;
  /** The note for today it was written with; absent on rows from before notes, which had none. */
  note?: string | null;
};

/** What about an item the greeting depends on: its title, days, whether it's done, and who has it. */
function stampsOf(db: Db, ids: string[]): Record<string, string> {
  if (ids.length === 0) return {};
  return Object.fromEntries(
    db
      .select({
        id: items.id,
        title: items.title,
        dueDate: items.dueDate,
        dueFrom: items.dueFrom,
        completedAt: items.completedAt,
        assigneeIds: items.assigneeIds,
      })
      .from(items)
      .where(inArray(items.id, ids))
      .all()
      .map((i) =>
        [
          i.id,
          JSON.stringify([i.title, i.dueDate, i.dueFrom, i.completedAt !== null, [...i.assigneeIds].sort()]),
        ] as const,
      ),
  );
}

/** Whether every item `greeting` names is as it was when written. */
function unchanged(db: Db, greeting: StoredGreeting): boolean {
  if (!greeting.stamps) return true;
  const now = stampsOf(db, Object.keys(greeting.stamps));
  return Object.entries(greeting.stamps).every(([id, stamp]) => now[id] === stamp);
}

function traceOf(
  brief: AgendaBrief,
  prefs: GreetingPrefs,
  timeZone: string,
  now: number,
  why: string | null,
  jev?: { scores: { items: Record<string, number> }; pick: GreetingPick; named: string },
): GreetingTrace {
  const open = brief.dueToday.filter((i) => i.completedAt === null).length;
  const all = new Map(
    [...brief.dueToday, ...brief.overdue, ...brief.thisWeek, ...brief.undated, ...brief.stale].map(
      (i) => [i.id, i],
    ),
  );
  const others = new Set(jev?.pick.others.map((i) => i.id));
  return {
    day: brief.today,
    partOfDay: brief.partOfDay,
    at: now,
    timeZone,
    why,
    looked: {
      dueToday: open,
      doneToday: brief.dueToday.length - open,
      slipped: brief.overdue.length,
      thisWeek: brief.thisWeek.length,
      undated: brief.undated.length,
      stale: brief.stale.length,
      finishedSince: brief.lookBack.finishedCount,
      sinceDay: brief.sinceDay,
      dayNote: brief.dayNote !== null,
    },
    moments: jev
      ? jev.pick.considered
      : null,
    items: jev
      ? Object.entries(jev.scores.items)
          .flatMap(([id, score]) => {
            const i = all.get(id);
            return i
              ? [
                  {
                    id,
                    title: i.title,
                    list: i.list,
                    score,
                    named: jev.named.includes(`{{item:${id}}}`),
                    other: others.has(id),
                  },
                ]
              : [];
          })
          .sort((a, b) => b.score - a.score)
      : null,
    model: why ? null : WRITER_MODEL,
    prefs: { length: prefs.length, note: prefs.note !== "" },
  };
}

/**
 * Whether every item `greeting` names is still on a list the viewer can
 * open, so a cached one never shows a title from a list they've left.
 */
function stillVisible(db: Db, viewerId: string, greeting: StoredGreeting): boolean {
  // Every id it holds a title for: named, in others, or weighed in the trace.
  const ids = [
    ...new Set([
      ...Object.keys(greeting.titles),
      ...greeting.others.map((o) => o.id),
      ...(greeting.trace?.items ?? []).map((i) => i.id),
    ]),
  ];
  if (ids.length === 0) return true;
  const seen = db
    .select({ id: items.id })
    .from(items)
    .innerJoin(projects, eq(items.projectId, projects.id))
    .where(both(inArray(items.id, ids), hasProjectAccess(viewerId)))
    .all();
  return seen.length === ids.length;
}

/**
 * Claude writes one person's greeting at once after a quiet spell, then waits
 * longer after each ask that follows close on the last: 10s, 30s, 1 min, 2
 * min, then 5 min at most…
 */
const BACKOFF_MS = [10_000, 30_000, 60_000, 2 * 60_000, 5 * 60_000];
/** …starting over once nothing has asked for this long past the wait… */
const QUIET_MS = 3 * 60_000;
/** …or this long when they ask for it with "Rewrite now" (the back-off's first step)… */
const ASK_NOW_EVERY_MS = 10_000;
/** …or this often after an ask for the same part of the day failed… */
const RETRY_FAILED_MS = 15 * 60_000;
/** …and this many times in a UTC day. */
const ASKS_PER_DAY = 40;
/** And for everyone on this server together, in a UTC day. */
const ASKS_PER_DAY_ALL = 2000;
const everyone = { day: "", asks: 0 };

function briefFor(db: Db, viewerId: string, timeZone: string, now: number) {
  const brief = buildAgendaBrief(db, viewerId, {
    now,
    timeZone,
    since: getAgendaReadAt(db, viewerId),
  });
  const name = getProfile(db, viewerId)?.name?.trim().split(/\s+/)[0] || null;
  return { brief, name, prefs: getGreetingPrefs(db, viewerId) };
}

/** The titles of the brief's items `text` names. */
function titlesIn(text: string, brief: AgendaBrief): Record<string, string> {
  const titles: Record<string, string> = {};
  for (const i of [
    ...brief.lookBack.finished,
    ...brief.lookBack.slipped,
    ...brief.dueToday,
    ...brief.overdue,
    ...brief.thisWeek,
    ...brief.undated,
    ...brief.stale,
  ]) {
    if (text.includes(`{{item:${i.id}}}`)) titles[i.id] = i.title;
  }
  return titles;
}

function fromTemplate(
  brief: AgendaBrief,
  name: string | null,
  prefs: GreetingPrefs,
  trace: GreetingTrace,
): Greeting {
  const hello = helloFor(brief, name);
  // templateGreeting always opens with the hello.
  const text = templateGreeting(brief, name, prefs.length).slice(hello.length).trimStart();
  return {
    hello,
    text,
    titles: titlesIn(text, brief),
    others: [],
    written: false,
    trace,
    note: brief.dayNote,
  };
}

/**
 * The viewer's greeting at `now` in `timeZone`, from the templates, looking
 * back to their last read.
 */
export function greetingFor(
  db: Db,
  viewerId: string,
  timeZone: string,
  now = Date.now(),
): Greeting {
  const { brief, name, prefs } = briefFor(db, viewerId, timeZone, now);
  return fromTemplate(
    brief,
    name,
    prefs,
    traceOf(brief, prefs, timeZone, now, "AI isn't set up on this server"),
  );
}

/**
 * The viewer's greeting with Jev's picks in Claude's words, when both `keys`
 * are set. Written once a morning, afternoon and evening and read back from
 * agenda_greetings in between; written afresh at once after a quiet spell,
 * then backing off (BACKOFF_MS), and at most ASKS_PER_DAY times a day per
 * person. Anything else, from a failed or rejected write to a limit, gives
 * the template greeting. `fetchImpl` is
 * injectable for tests.
 */
export async function writtenGreetingFor(
  db: Db,
  viewerId: string,
  timeZone: string,
  keys: { jev: string | undefined; anthropic: string | undefined },
  now = Date.now(),
  fetchImpl: typeof fetch = fetch,
  /** Asked for with "Rewrite now": it waits ASK_NOW_EVERY_MS, not the back-off. The daily caps still hold. */
  rewriteNow = false,
): Promise<Greeting> {
  const { brief, name, prefs } = briefFor(db, viewerId, timeZone, now);
  const hello = helloFor(brief, name);
  const template = (why: string, trace = traceOf(brief, prefs, timeZone, now, why)) =>
    fromTemplate(brief, name, prefs, { ...trace, why });
  if (!keys.jev || !keys.anthropic) return template("AI isn't set up on this server");
  // One greeting a morning, afternoon and evening, written again when an
  // item it names changes (ticked off, renamed, moved to another day or
  // person) or the viewer's note for today does, but not as other things
  // change or a read stamp moves the look-back.
  const key = `${brief.today}:${brief.partOfDay}`;
  const row = db.select().from(agendaGreetings).where(eq(agendaGreetings.userId, viewerId)).get();
  const same = row?.key === key ? row.greeting : null;
  // One kept from before traces were recorded is written again, once, so
  // "What is this?" has something to explain.
  const kept = same?.text && same.trace && stillVisible(db, viewerId, same) ? same : null;
  // The stamps stay on the server, and the note shown is today's as it is now.
  const shown = (s: StoredGreeting): Greeting => {
    const g = { ...s };
    delete g.stamps;
    delete g.note;
    return { hello, ...g, written: true, note: brief.dayNote };
  };
  if (kept && unchanged(db, kept) && (kept.note ?? null) === brief.dayNote) return shown(kept);
  // Until it may ask again, the one it has stays, out of date or not,
  // rather than the reader seeing it swap for the built-in one. With none
  // kept, the built-in one, still saying when to ask again.
  const stale = (fallback: Greeting, retryInMs: number): Greeting => ({
    ...(kept ? shown(kept) : fallback),
    retryInMs,
  });
  // Counted by UTC day, not the viewer's: their timezone is theirs to
  // change, and a new one mustn't start a new count.
  const utcDay = dayOf(now, "UTC");
  const asks = row?.askedDay === utcDay ? row.asks : 0;
  if (everyone.day !== utcDay) Object.assign(everyone, { day: utcDay, asks: 0 });
  // A write that failed for this part of the day likely fails again soon.
  const failed = row?.key === key && !same?.text;
  // Each ask close on the last waits longer; a quiet spell starts it over.
  const streak = row?.streak ?? 0;
  const backoff = BACKOFF_MS[Math.min(Math.max(streak, 1), BACKOFF_MS.length) - 1];
  const quiet = !row || now - row.askedAt >= backoff + QUIET_MS;
  const wait = failed ? RETRY_FAILED_MS : rewriteNow ? ASK_NOW_EVERY_MS : backoff;
  // A failed write still waits its full time, quiet or not.
  if (row && (failed || !quiet) && now - row.askedAt < wait) {
    const retryInMs = row.askedAt + wait - now;
    const minutes = Math.ceil(retryInMs / 60_000);
    if (!failed) {
      const seconds = Math.ceil(retryInMs / 1000);
      return stale(template(`One was asked for moments ago; it asks again in ${seconds}s`), retryInMs);
    }
    // The page asks again when told: sooner than this, as it checks back
    // at least every 30s, by when one being written has likely landed.
    if (!same) return { ...template("Claude is writing it, or the last try didn't finish"), retryInMs };
    const last = same.trace?.why ?? "The last try didn't work";
    const why = `${last}. It tries again in ${minutes} min`;
    // Its trace only while every title in it is still the viewer's to see.
    return { ...(stillVisible(db, viewerId, same) ? template(why, same.trace) : template(why)), retryInMs };
  }
  // Out of date with no more writes today: the built-in one, which is up to
  // date, rather than a written one that's wrong until tomorrow.
  if (asks >= ASKS_PER_DAY) return template(`You've had today's ${ASKS_PER_DAY} written greetings`);
  if (everyone.asks >= ASKS_PER_DAY_ALL) return template("This server has written all it may today");
  // Count the ask before awaiting it, so loads at the same moment ask once.
  everyone.asks += 1;
  // The written one it has stays meanwhile, so a load at the same moment (another
  // tab or device) keeps showing it, and asks again when this one is due back.
  const asked = {
    key,
    greeting: row?.key === key && row.greeting?.text ? row.greeting : null,
    askedAt: now,
    askedDay: utcDay,
    asks: asks + 1,
    streak: quiet ? 1 : streak + 1,
  };
  // audit-exempt: a cache of one person's greeting, seen by nobody else.
  db.insert(agendaGreetings)
    .values({ userId: viewerId, ...asked })
    .onConflictDoUpdate({ target: agendaGreetings.userId, set: asked })
    .run();
  // Only if no later ask has claimed the row since.
  const keep = (greeting: StoredGreeting) => {
    // audit-exempt: as above.
    db.update(agendaGreetings)
      .set({ greeting })
      .where(both(eq(agendaGreetings.userId, viewerId), eq(agendaGreetings.key, key)))
      .run();
  };

  // How the items stood when the brief was built, before any await: one that
  // changes while it's being written gets it written again.
  const { lookBack, dueToday, overdue, thisWeek, undated, stale: untouched } = brief;
  const briefed = stampsOf(
    db,
    [lookBack.finished, lookBack.slipped, dueToday, overdue, thisWeek, undated, untouched].flatMap((l) =>
      l.map((i) => i.id),
    ),
  );

  const scores = await scoreGreeting(brief, keys.jev, fetchImpl);
  if (!scores) {
    const trace = traceOf(brief, prefs, timeZone, now, "Jev didn't answer, so there was nothing to go on");
    keep({ text: "", titles: {}, others: [], trace });
    return template(trace.why ?? "", trace);
  }
  const pick = pickGreeting(brief, scores, LENGTH_LIMITS[prefs.length].moments);
  const written = await writeGreeting(brief, pick, keys.anthropic, fetchImpl, prefs);
  if ("failed" in written) {
    const trace = traceOf(brief, prefs, timeZone, now, written.failed, { scores, pick, named: "" });
    keep({ text: "", titles: {}, others: [], trace });
    return template(written.failed, trace);
  }
  const titles = titlesIn(written.text, brief);
  const greeting: StoredGreeting = {
    text: written.text,
    titles,
    stamps: Object.fromEntries(Object.keys(titles).flatMap((id) => (id in briefed ? [[id, briefed[id]]] : []))),
    others: pick.others.map((i) => ({ id: i.id, title: i.title })),
    trace: traceOf(brief, prefs, timeZone, now, null, { scores, pick, named: written.text }),
    note: brief.dayNote,
  };
  keep(greeting);
  return shown(greeting);
}

/** What an action token does when tapped. */
export type GreetingAction = "triage" | "lighten";

const item = (i: BriefItem) => `{{item:${i.id}}}`;
const action = (name: GreetingAction, words: string) => `{{action:${name}|${words}}}`;

const NUMBERS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const count = (n: number) => NUMBERS[n] ?? String(n);
const things = (n: number) => `${count(n)} ${n === 1 ? "thing" : "things"}`;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "a and b are still open this week.", or null when nothing is. */
function stillThisWeek(brief: AgendaBrief): string | null {
  const week = brief.thisWeek;
  if (week.length === 0) return null;
  return week.length <= 2
    ? `${capital(and(week.map(item)))} ${week.length === 1 ? "is" : "are"} still open this week.`
    : `A few things are still open this week, ${and(week.slice(0, 2).map(item))} among them.`;
}

/** "a", "a and b", "a, b and c". */
function and(parts: string[]): string {
  return parts.length < 2 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/**
 * One of `options`, the same all through one part of one day, so a reload
 * doesn't reword it, but not the same every morning.
 */
function pick(brief: AgendaBrief, salt: string, options: string[]): string {
  let h = 0;
  for (const c of `${brief.today}:${brief.partOfDay}:${salt}`) h = (h * 31 + c.charCodeAt(0)) | 0;
  return options[Math.abs(h) % options.length];
}

/** "yesterday", "Friday", or null when the last read was today or long ago. */
function sinceWord(brief: AgendaBrief, sinceDay: string): string | null {
  if (sinceDay >= brief.today) return null;
  if (sinceDay === addDays(brief.today, -1)) return "yesterday";
  if (sinceDay < addDays(brief.today, -6)) return "last time";
  return weekdayOf(sinceDay);
}

const weekdayOf = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });

/** The busiest day from tomorrow to a week on, when it stands out. */
function heavyDay(brief: AgendaBrief): { day: string; open: number } | null {
  const week = brief.ahead.slice(0, 7);
  const busiest = week.reduce<{ day: string; open: number } | null>(
    (best, d) => (!best || d.open > best.open ? d : best),
    null,
  );
  if (!busiest || busiest.open < 4) return null;
  const others = week.filter((d) => d !== busiest);
  const usual = others.reduce((n, d) => n + d.open, 0) / Math.max(others.length, 1);
  return busiest.open >= 2 * usual ? busiest : null;
}

function dayName(day: string, today: string): string {
  const name = weekdayOf(day);
  if (day === addDays(today, 1)) return "Tomorrow";
  return day > addDays(today, 6) ? `Next ${name}` : name;
}

/** "Good morning, Fred.", or without the name when it's null. */
export function helloFor(brief: AgendaBrief, name: string | null): string {
  const to = name ? `, ${name}` : "";
  if (brief.partOfDay === "morning") return `Good morning${to}.`;
  if (brief.partOfDay === "afternoon") return `Good afternoon${to}.`;
  return `Evening${to}.`;
}

/**
 * The greeting for `brief`, with item and action tokens. `name` is the
 * viewer's first name, or null to greet without one.
 */
export function templateGreeting(
  brief: AgendaBrief,
  name: string | null,
  length: GreetingLength = "long",
): string {
  const hello = helloFor(brief, name);

  const open = brief.dueToday.filter((i) => i.completedAt === null);
  const doneToday = brief.dueToday.length - open.length;

  // Evening winds down: today's left, or nothing, and no looking ahead.
  if (brief.partOfDay === "evening") {
    if (brief.dueToday.length === 0) {
      return `${hello} ${pick(brief, "evening-quiet", [
        "A quiet day. Enjoy the evening.",
        "Nothing was due today. Enjoy the evening.",
      ])}`;
    }
    if (open.length === 0) {
      return `${hello} ${pick(brief, "evening-clear", [
        "That's everything for today. Enjoy the evening.",
        "Nothing left for today. Enjoy the rest of the evening.",
      ])}`;
    }
    return `${hello} ${capital(things(open.length))} still open from today. ${pick(brief, "evening-open", [
      "They'll keep until tomorrow.",
      "Fine to leave them for tomorrow.",
    ])}`;
  }

  // What it says, most important first; the look-back goes before them,
  // when the reader's length leaves room.
  const sentences: string[] = [];

  // Warmth from the look-back, when there's a day to look back to.
  const finished = brief.lookBack.finishedCount;
  const when = brief.sinceDay ? sinceWord(brief, brief.sinceDay) : null;
  const back =
    when && finished > 0
      ? `${when === "last time" ? "Since last time" : `Since ${when}`} you've finished ${finished === 1 ? item(brief.lookBack.finished[0]) : count(finished)}${finished >= 3 ? " — nice" : ""}.`
      : null;

  const day = brief.weekday;
  if (brief.overdue.length > 0) {
    // What slipped comes first, gently.
    sentences.push(
      brief.overdue.length === 1
        ? `${item(brief.overdue[0])} is still waiting. No rush — want to ${action("triage", "give it a new day")}?`
        : `A few earlier things are still waiting. No rush — want to ${action("triage", "give them new days")}, or let some go?`,
    );
    // With nothing open today, the week too, as Claude's greeting says both.
    const week = open.length === 0 ? stillThisWeek(brief) : null;
    if (week) sentences.push(week);
  } else if (open.length > 0) {
    if (brief.partOfDay === "afternoon") {
      sentences.push(
        open.length === 1
          ? `Just ${item(open[0])} left for today.`
          : `${capital(things(open.length))} left for today.`,
      );
    } else if (open.length === 1) {
      sentences.push(`A gentle ${day}: just ${item(open[0])} today.`);
    } else if (open.length <= 3) {
      sentences.push(`A gentle ${day}: ${and(open.map(item))} today.`);
    } else {
      sentences.push(
        `A fuller ${day}: ${things(open.length)} today. ${item(open[0])} is a good place to start.`,
      );
    }
  } else if (doneToday > 0) {
    // One part, so a short greeting doesn't stop at "that's everything".
    const week = stillThisWeek(brief);
    sentences.push(week ? `That's everything for today. ${week}` : "That's everything for today.");
  } else {
    // Nothing due: what's left this week, or look ahead, or offer something
    // undated, or just be quiet.
    const week = stillThisWeek(brief);
    const heavy = heavyDay(brief);
    const nudge = brief.undated.slice(0, 2);
    const stale = brief.stale.slice(0, 2);
    if (week) {
      sentences.push(`Nothing due today. ${week}`);
    } else if (heavy) {
      sentences.push(
        `Nothing due today. ${dayName(heavy.day, brief.today)} looks busy, so maybe move one thing earlier?`,
      );
    } else if (nudge.length > 0) {
      sentences.push(
        `Nothing due today. ${and(nudge.map(item))} might be worth a look, if you feel like picking something up.`,
      );
    } else if (stale.length > 0) {
      sentences.push(
        stale.length === 1
          ? `Nothing due today. ${item(stale[0])} has been sitting a while, if you feel like picking it up.`
          : `Nothing due today. Two things in No date have been sitting a while, if you feel like picking one up: ${and(stale.map(item))}.`,
      );
    } else {
      sentences.push(
        pick(brief, "quiet", [
          `Nothing due today. A quiet ${day}.`,
          `Nothing due today. Enjoy the quiet.`,
        ]),
      );
    }
  }

  // Short says the main thing; medium a second, or the look-back; long all.
  const kept =
    length === "short"
      ? sentences.slice(0, 1)
      : length === "medium" && sentences.length >= 2
        ? sentences.slice(0, 2)
        : [...(back ? [back] : []), ...sentences];
  return [hello, ...kept].join(" ");
}
