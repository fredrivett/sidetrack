// The facts the Agenda's greeting is written from: what time it is for the
// viewer, what they've done and what slipped since they last read one, what's
// on today, what's coming, and which undated items might want a nudge. Reads
// the DB and writes nothing; the greeting (templates now, Jev and a writer
// later) only ever states what's here.

import { and, eq, gte, inArray, isNull, max, or } from "drizzle-orm";
import { splitTagged, WRAP_UP_TAGS } from "../lib/dayTags";
import { isYours } from "../lib/filters";
import { formatItemRef } from "../lib/itemRef";
import { nestItems } from "../lib/itemTree";
import { addDays, agendaSection, dayOf, weekSpan } from "../lib/time";
import { hasItemAccess, inDayOf } from "./access";
import type { Db } from "./db";
import { getDayNote } from "./dayNotes";
import { getWrapUp } from "./dayWrapUps";
import { listAssignees } from "./members";
import { listProjects } from "./projects";
import { auditLog, type Item, items, projects } from "./schema";

/** At most this many items in each look-back list, however long the viewer was away. */
export const LOOK_BACK_CAP = 10;
/** The look-back reaches this far at most: the greeting says "since last time" beyond a week. */
const LOOK_BACK_DAYS = 7;
/** At most this many undated items in each of `undated` and `stale`. */
export const CANDIDATE_CAP = 15;
/** An undated item nobody has touched for this long is stale. */
export const STALE_DAYS = 21;
/** An undated item added this recently might still be on the viewer's mind. */
const RECENT_DAYS = 7;
// Titles that read like something with a deadline even without a date.
const DEADLINE_WORDS =
  /\b(renew(al)?|expir(e|es|ed|y)|deadline|submit|invoice|bill|pay|tax(es)?|rsvp|register|apply|book)\b/i;

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export type PartOfDay = "morning" | "afternoon" | "evening";

export interface BriefItem {
  id: string;
  /** Display ref, such as "SDT-12". */
  ref: string;
  title: string;
  /** The list it's on, by name. */
  list: string;
  /** The parent's title, for a sub-item. */
  parent: string | null;
  dueDate: string | null;
  dueFrom: string | null;
  completedAt: number | null;
  repeats: boolean;
  /** Open sub-items left that count for the viewer. */
  stepsLeft: number;
}

export interface AgendaBrief {
  /** The viewer's day (4am turnover), YYYY-MM-DD. */
  today: string;
  weekday: (typeof WEEKDAYS)[number];
  weekend: boolean;
  partOfDay: PartOfDay;
  /** When the viewer last read a greeting; null the first time. */
  since: number | null;
  /** The viewer's day `since` fell in. */
  sinceDay: string | null;
  /** Since `since` (a week at most), each newest first and LOOK_BACK_CAP long at most. */
  lookBack: {
    /** What the viewer finished (top-level, or a sub-item finished on its own). */
    finished: BriefItem[];
    /** How many they finished, past the cap too. */
    finishedCount: number;
    /** Open items whose last day passed since `since`. */
    slipped: BriefItem[];
  };
  /** The Agenda's Today: open, or finished today. */
  dueToday: BriefItem[];
  /**
   * How many items the viewer finished today, whenever each was due: the
   * items in their day (inDayOf, as their shared day on Check-ins counts
   * them, so assigned to them), on every active list. Cancelled ones
   * weren't done.
   */
  doneToday: number;
  /** The Agenda's Overdue, open items only. */
  overdue: BriefItem[];
  /** Open single-day items per day, from tomorrow to the end of next week. */
  ahead: Array<{ day: string; open: number }>;
  /** Open items due this week after today: spans under way, and days still to come (the Agenda's Tomorrow and This week). */
  thisWeek: BriefItem[];
  /** Undated open items with a reason to come up: recent or deadline-ish. */
  undated: BriefItem[];
  /** Undated open items nobody has touched for STALE_DAYS, oldest touch first. */
  stale: BriefItem[];
  /** What the viewer wrote about today (dayNotes.ts), in their own words; null for none. */
  dayNote: string | null;
  /** How today went, once the viewer has closed it (dayWrapUps.ts): its moods and words; null while it's open. */
  closed: DayWentAs | null;
  /** How yesterday went, if they closed it; null if they didn't. */
  lastNight: DayWentAs | null;
}

/** How a closed day went: its wrap-up's moods, and its words, if any. */
export interface DayWentAs {
  mood: string[];
  words: string | null;
}

function wentAs(db: Db, userId: string, day: string): DayWentAs | null {
  const w = getWrapUp(db, userId, day);
  if (!w) return null;
  const { tags, rest } = splitTagged(w.text, WRAP_UP_TAGS);
  return { mood: tags, words: rest || null };
}

/** Morning until noon, afternoon until 6pm, then evening until the 4am turnover. */
function partOfDay(now: number, timeZone: string): PartOfDay {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(now),
  );
  if (hour >= 4 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  return "evening";
}

/**
 * The brief for `viewerId` at `now` in `timeZone`, looking back to `since`
 * (their last read greeting; null for none). Covers their active lists only.
 */
export function buildAgendaBrief(
  db: Db,
  viewerId: string,
  opts: { now: number; timeZone: string; since: number | null },
): AgendaBrief {
  const { now, timeZone } = opts;
  // Older reads look back a week, so a long absence doesn't load months of history.
  const since =
    opts.since === null ? null : Math.max(opts.since, now - LOOK_BACK_DAYS * 86_400_000);
  const today = dayOf(now, timeZone);
  const weekday = WEEKDAYS[new Date(`${today}T12:00:00Z`).getUTCDay()];

  const lists = new Map(
    listProjects(db, viewerId)
      .filter((p) => p.status === "active")
      .map((p, i) => [p.id, { ...p, order: i }]),
  );
  // Open items, and ones finished since the look-back or recently enough to
  // be today's in any zone (as activeItemsForDay in projects.ts).
  const doneFrom = Math.min(since ?? now, Date.parse(`${addDays(today, -1)}T00:00:00Z`));
  const found = db
    .select({ items })
    .from(items)
    .innerJoin(projects, eq(projects.id, items.projectId))
    .where(
      and(
        hasItemAccess(viewerId),
        eq(projects.status, "active"),
        or(isNull(items.completedAt), gte(items.completedAt, doneFrom)),
      ),
    )
    .all()
    .map((r) => r.items)
    // Board order, then list order.
    .sort(
      (a, b) =>
        (lists.get(a.projectId)?.order ?? 0) - (lists.get(b.projectId)?.order ?? 0) ||
        a.position.localeCompare(b.position) ||
        a.id.localeCompare(b.id),
    );
  // Positions are scoped to the parent, so list each parent, then its sub-items.
  const rows = nestItems(found).flatMap(({ children, ...it }) => [it, ...children]);
  const byId = new Map(rows.map((i) => [i.id, i]));
  const parentOf = (i: Item) => (i.parentId ? byId.get(i.parentId) : undefined);
  // Lists nobody else can be assigned on, where unassigned items are the viewer's.
  const aloneOn = new Map<string, boolean>();
  const alone = (projectId: string) => {
    let is = aloneOn.get(projectId);
    if (is === undefined) {
      is = listAssignees(db, viewerId, projectId).every((a) => a.userId === viewerId || !a.canEdit);
      aloneOn.set(projectId, is);
    }
    return is;
  };
  const mine = rows.filter((i) => isYours(i, parentOf(i), viewerId, alone));
  const mineIds = new Set(mine.map((i) => i.id));

  const stepsLeft = new Map<string, number>();
  for (const i of mine) {
    if (i.parentId && i.completedAt === null) {
      stepsLeft.set(i.parentId, (stepsLeft.get(i.parentId) ?? 0) + 1);
    }
  }
  const brief = (i: Item): BriefItem => {
    const list = lists.get(i.projectId);
    return {
      id: i.id,
      ref: formatItemRef(list?.prefix ?? "", i.number),
      title: i.title,
      list: list?.name ?? "",
      parent: parentOf(i)?.title ?? null,
      dueDate: i.dueDate,
      dueFrom: i.dueFrom,
      completedAt: i.completedAt,
      repeats: i.repeatUnit !== null,
      stepsLeft: stepsLeft.get(i.id) ?? 0,
    };
  };
  const open = mine.filter((i) => i.completedAt === null);
  const sectionOf = (i: Item) => agendaSection(i, parentOf(i), today, timeZone);

  // Look back: what the viewer finished (by the audit log, so a list-mate's
  // ticks aren't theirs) and what slipped. A sub-item finished with its
  // parent goes with the parent.
  let finished: Array<{ item: Item; at: number }> = [];
  let slipped: Array<{ item: Item; at: number }> = [];
  if (since !== null) {
    const done = db
      .selectDistinct({ id: auditLog.entityId })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.actor, viewerId),
          eq(auditLog.action, "complete"),
          eq(auditLog.entityType, "item"),
          gte(auditLog.ts, since),
        ),
      )
      .all();
    const doneIds = new Set(done.map((d) => d.id));
    finished = [...doneIds]
      .map((id) => byId.get(id))
      // Cancelled since isn't finished, however it was ticked before.
      .filter((i): i is Item => i?.completedAt != null && i.completedAt >= since && !i.cancelled)
      .filter((i) => !i.parentId || !doneIds.has(i.parentId))
      .map((item) => ({ item, at: item.completedAt ?? 0 }));
    const sinceDay = dayOf(since, timeZone);
    slipped = open
      .filter((i) => i.dueDate !== null && i.dueDate >= sinceDay && i.dueDate < today)
      .map((item) => ({ item, at: Date.parse(`${addDays(item.dueDate ?? today, 1)}T00:00:00Z`) }));
  }
  const newestFirst = (list: Array<{ item: Item; at: number }>) =>
    list
      .sort((a, b) => b.at - a.at)
      .slice(0, LOOK_BACK_CAP)
      .map((e) => brief(e.item));

  // Ahead: tomorrow to the Sunday of next week.
  const lastDay = weekSpan(today, 1, "week").dueDate;
  const ahead: AgendaBrief["ahead"] = [];
  for (let day = addDays(today, 1); day <= lastDay; day = addDays(day, 1)) {
    ahead.push({
      day,
      open: open.filter((i) => !i.dueFrom && i.dueDate === day).length,
    });
  }

  // Undated: top-level, or a sub-item whose parent isn't the viewer's to see
  // here, so a checklist comes up once, as its parent.
  const undatedOpen = open.filter(
    (i) => sectionOf(i) === "No date" && !(i.parentId && mineIds.has(i.parentId)),
  );
  const touched = lastTouched(
    db,
    undatedOpen.map((i) => i.id),
  );
  const touchedAt = (i: Item) => touched.get(i.id) ?? i.createdAt;
  const staleBefore = now - STALE_DAYS * 86_400_000;
  const stale = undatedOpen
    .filter((i) => touchedAt(i) < staleBefore)
    .sort((a, b) => touchedAt(a) - touchedAt(b))
    .slice(0, CANDIDATE_CAP);
  const staleIds = new Set(stale.map((i) => i.id));
  const recentAfter = now - RECENT_DAYS * 86_400_000;
  const undated = undatedOpen
    .filter(
      (i) => !staleIds.has(i.id) && (i.createdAt >= recentAfter || DEADLINE_WORDS.test(i.title)),
    )
    .slice(0, CANDIDATE_CAP);

  // The Agenda's This week, and its Tomorrow unless that's next week (on a Sunday).
  const sunday = weekSpan(today, 0, "week").dueDate;
  const weekOpen = open.filter((i) => {
    const s = sectionOf(i);
    return s === "This week" || (s === "Tomorrow" && (i.dueDate ?? "") <= sunday);
  });
  const weekIds = new Set(weekOpen.map((i) => i.id));

  return {
    today,
    weekday,
    weekend: weekday === "Saturday" || weekday === "Sunday",
    partOfDay: partOfDay(now, timeZone),
    since,
    sinceDay: since === null ? null : dayOf(since, timeZone),
    lookBack: {
      finished: newestFirst(finished),
      finishedCount: finished.length,
      slipped: newestFirst(slipped),
    },
    dueToday: mine.filter((i) => sectionOf(i) === "Today").map(brief),
    doneToday: db
      .select({ completedAt: items.completedAt })
      .from(items)
      .innerJoin(projects, eq(projects.id, items.projectId))
      .where(
        and(
          hasItemAccess(viewerId),
          eq(projects.status, "active"),
          inDayOf(viewerId, "today"),
          eq(items.cancelled, false),
          gte(items.completedAt, doneFrom),
        ),
      )
      .all()
      .filter((i) => i.completedAt !== null && dayOf(i.completedAt, timeZone) === today).length,
    overdue: open.filter((i) => sectionOf(i) === "Overdue").map(brief),
    ahead,
    // A checklist comes up once, as its parent, when the parent is here too.
    thisWeek: weekOpen
      .filter((i) => !(i.parentId && weekIds.has(i.parentId)))
      // By the day each starts, as the Agenda lists them.
      .sort((a, b) => (a.dueFrom ?? a.dueDate ?? "").localeCompare(b.dueFrom ?? b.dueDate ?? ""))
      .map(brief),
    undated: undated.map(brief),
    stale: stale.map(brief),
    dayNote: getDayNote(db, viewerId, today),
    closed: wentAs(db, viewerId, today),
    lastNight: wentAs(db, viewerId, addDays(today, -1)),
  };
}

/**
 * The latest audit row on each item, its sub-items or its comments, by item
 * id: when someone last changed or discussed it. Items with no rows are left out.
 */
function lastTouched(db: Db, ids: string[]): Map<string, number> {
  const touched = new Map<string, number>();
  if (ids.length === 0) return touched;
  const keep = (id: string | null, ts: number | null) => {
    if (id && ts !== null && ts > (touched.get(id) ?? -Infinity)) touched.set(id, ts);
  };
  // An item's own rows, then its sub-items' and comments' (which name it as parent).
  for (const [column, entities] of [
    [auditLog.entityId, ["item"]],
    [auditLog.parentId, ["item", "comment"]],
  ] as const) {
    for (const r of db
      .select({ id: column, ts: max(auditLog.ts) })
      .from(auditLog)
      .where(and(inArray(auditLog.entityType, [...entities]), inArray(column, ids)))
      .groupBy(column)
      .all()) {
      keep(r.id, r.ts);
    }
  }
  return touched;
}
