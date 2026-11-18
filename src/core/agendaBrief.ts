// The facts the Agenda's greeting is written from: what time it is for the
// viewer, what they've done and what slipped since they last read one, what's
// on today, what's coming, and which undated items might want a nudge. Reads
// the DB and writes nothing; the greeting (templates now, Jev and a writer
// later) only ever states what's here.

import { and, eq, gte, inArray, isNull, max, or } from "drizzle-orm";
import { nestItems } from "../lib/itemTree";
import { addDays, agendaSection, dayOf, weekSpan } from "../lib/time";
import { hasProjectAccess } from "./access";
import type { Db } from "./db";
import { listProjects } from "./projects";
import { auditLog, type Item, items, projects } from "./schema";

/** At most this many items in the look-back, however long the viewer was away. */
export const LOOK_BACK_CAP = 10;
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
  /** Since `since`, newest first, LOOK_BACK_CAP between them. */
  lookBack: {
    /** What the viewer finished (top-level, or a sub-item finished on its own). */
    finished: BriefItem[];
    /** Open items whose last day passed since `since`. */
    slipped: BriefItem[];
  };
  /** The Agenda's Today: open, or finished today. */
  dueToday: BriefItem[];
  /** The Agenda's Overdue, open items only. */
  overdue: BriefItem[];
  /** Open single-day items per day, from tomorrow to the end of next week. */
  ahead: Array<{ day: string; open: number }>;
  /** Open spans ("this week") under way today. */
  spans: BriefItem[];
  /** Undated open items with a reason to come up: recent or deadline-ish. */
  undated: BriefItem[];
  /** Undated open items nobody has touched for STALE_DAYS, oldest touch first. */
  stale: BriefItem[];
}

/**
 * Whether `item` is the viewer's to think about: assigned to them, or
 * unassigned. An unassigned sub-item counts only when its parent does, so a
 * step under someone else's task stays theirs.
 */
function counts(item: Item, parent: Item | undefined, viewerId: string): boolean {
  if (item.assigneeIds.includes(viewerId)) return true;
  if (item.assigneeIds.length > 0) return false;
  return !parent || parent.assigneeIds.length === 0 || parent.assigneeIds.includes(viewerId);
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
  const { now, timeZone, since } = opts;
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
        hasProjectAccess(viewerId),
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
  const mine = rows.filter((i) => counts(i, parentOf(i), viewerId));
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
      ref: `${list?.prefix ?? ""}-${i.number}`,
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
      .filter((i): i is Item => i?.completedAt != null && i.completedAt >= since)
      .filter((i) => !i.parentId || !doneIds.has(i.parentId))
      .map((item) => ({ item, at: item.completedAt ?? 0 }));
    const sinceDay = dayOf(since, timeZone);
    slipped = open
      .filter((i) => i.dueDate !== null && i.dueDate >= sinceDay && i.dueDate < today)
      .map((item) => ({ item, at: Date.parse(`${addDays(item.dueDate ?? today, 1)}T00:00:00Z`) }));
  }
  const kept = new Set(
    [...finished, ...slipped]
      .sort((a, b) => b.at - a.at)
      .slice(0, LOOK_BACK_CAP)
      .map((e) => e.item.id),
  );
  const newestFirst = (list: Array<{ item: Item; at: number }>) =>
    list
      .filter((e) => kept.has(e.item.id))
      .sort((a, b) => b.at - a.at)
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

  return {
    today,
    weekday,
    weekend: weekday === "Saturday" || weekday === "Sunday",
    partOfDay: partOfDay(now, timeZone),
    since,
    lookBack: { finished: newestFirst(finished), slipped: newestFirst(slipped) },
    dueToday: mine.filter((i) => sectionOf(i) === "Today").map(brief),
    overdue: open.filter((i) => sectionOf(i) === "Overdue").map(brief),
    ahead,
    spans: open
      .filter((i) => i.dueFrom !== null && i.dueFrom <= today && (i.dueDate ?? "") >= today)
      .map(brief),
    undated: undated.map(brief),
    stale: stale.map(brief),
  };
}

/**
 * The latest audit row on each item or any of its sub-items, by item id: when
 * someone last changed it. Items with no rows are left out.
 */
function lastTouched(db: Db, ids: string[]): Map<string, number> {
  const touched = new Map<string, number>();
  if (ids.length === 0) return touched;
  const keep = (id: string | null, ts: number | null) => {
    if (id && ts !== null && ts > (touched.get(id) ?? -Infinity)) touched.set(id, ts);
  };
  const isItem = eq(auditLog.entityType, "item");
  for (const column of [auditLog.entityId, auditLog.parentId]) {
    for (const r of db
      .select({ id: column, ts: max(auditLog.ts) })
      .from(auditLog)
      .where(and(isItem, inArray(column, ids)))
      .groupBy(column)
      .all()) {
      keep(r.id, r.ts);
    }
  }
  return touched;
}
