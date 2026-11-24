// Smart due dates: an item due relative to something not known yet, such as
// "before our next trip". Its rule (items.smart_rule) is the person's words;
// its matches (item_smart_matches) are the items that fit it, such as
// "Lisbon flights". The due date is worked out here, never chosen: the
// earliest start of an open, dated match, smart_lead days before. With no
// such match it has no date and waits for one.
//
// The date follows its matches. Whatever changes one (a new date, ticking it
// off, reopening or deleting it) calls recalibrate in the same
// transaction, which works the dates out again and logs each move as a
// `system` change saying which match it now comes from. A smart item can be
// another's match, so a move carries on down the chain.

import { and, asc, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { formatItemRef } from "../lib/itemRef";
import { addDays } from "../lib/time";
import { hasProjectAccess, listAccess, requireListAccess } from "./access";
import { type AuditOrigin, recordAudit, SYSTEM_ACTOR } from "./audit";
import type { Db } from "./db";
import type { AnchorAt, DueAt, ItemChanges, SmartRule } from "./events";
import { type Item, itemSmartMatches, items, projects } from "./schema";

/** Longest rule, in characters. */
export const MAX_SMART_RULE = 200;
/** Most days before a match an item can be due. */
export const MAX_SMART_LEAD = 365;

/** The day a match starts: a span's first day. */
const startDay = sql<string>`coalesce(${items.dueFrom}, ${items.dueDate})`;

function assertRule(input: SmartRule): SmartRule {
  const rule = input.rule.trim().replace(/\s+/g, " ");
  if (!rule) throw new Error("a smart due date needs a rule, such as “before our next trip”");
  if (rule.length > MAX_SMART_RULE) {
    throw new Error(`a smart due date's rule is at most ${MAX_SMART_RULE} characters`);
  }
  if (!Number.isInteger(input.lead) || input.lead < 0 || input.lead > MAX_SMART_LEAD) {
    throw new Error(`invalid lead: ${input.lead} (expected 0 to ${MAX_SMART_LEAD} days)`);
  }
  return { rule, lead: input.lead };
}

function anchorAt(it: Pick<Item, "id" | "title" | "projectId">): AnchorAt {
  return { itemId: it.id, title: it.title, projectId: it.projectId };
}

/** The item, if `userId` can open its list. */
function visibleItem(db: Db, userId: string, id: string): Item | undefined {
  return db
    .select({ items })
    .from(items)
    .innerJoin(projects, eq(projects.id, items.projectId))
    .where(and(eq(items.id, id), hasProjectAccess(userId)))
    .get()?.items;
}

/** The open, dated match a smart item's date comes from now: the earliest to start. */
function currentAnchor(db: Db, itemId: string): (Item & { start: string }) | undefined {
  const row = db
    .select({ items, start: startDay })
    .from(itemSmartMatches)
    .innerJoin(items, eq(items.id, itemSmartMatches.anchorId))
    .where(
      and(
        eq(itemSmartMatches.itemId, itemId),
        eq(itemSmartMatches.removed, false),
        isNull(items.completedAt),
        isNotNull(items.dueDate),
      ),
    )
    .orderBy(asc(startDay), asc(items.id))
    .get();
  return row && { ...row.items, start: row.start };
}

/**
 * Work out `item`'s smart due date again and save it, inside the caller's
 * transaction. Returns what to log when it moved, or null when it didn't.
 */
function applySmartDue(tx: Db, item: Item, lead: number): Pick<ItemChanges, "due" | "smartDue"> | null {
  const anchor = currentAnchor(tx, item.id);
  const due: DueAt = anchor
    ? { dueDate: addDays(anchor.start, -lead), dueFrom: null }
    : { dueDate: null, dueFrom: null };
  if (due.dueDate === item.dueDate && due.dueFrom === item.dueFrom) return null;
  // audit-exempt: runs inside the caller's transaction, which logs the move.
  tx.update(items).set(due).where(eq(items.id, item.id)).run();
  return {
    due,
    smartDue: {
      was: { dueDate: item.dueDate, dueFrom: item.dueFrom },
      anchor: anchor ? anchorAt(anchor) : null,
    },
  };
}

/** Open smart items with a match among `anchorIds`. */
function dependentsOf(tx: Db, anchorIds: string[]): Item[] {
  if (anchorIds.length === 0) return [];
  return tx
    .selectDistinct({ items })
    .from(itemSmartMatches)
    .innerJoin(items, eq(items.id, itemSmartMatches.itemId))
    .where(
      and(
        inArray(itemSmartMatches.anchorId, anchorIds),
        eq(itemSmartMatches.removed, false),
        isNotNull(items.smartRule),
        isNull(items.completedAt),
      ),
    )
    .all()
    .map((r) => r.items);
}

/**
 * Work out again the open smart items among `ids`, and every one that hangs
 * off them however far down, logging each move as a `system` change. Each is
 * worked out once, after the matches it hangs off that may move too, so a
 * chain (D hangs off A and off B, which hangs off A) ends on the right date
 * with one log row. Call inside the transaction that changed them.
 */
export function recalibrate(tx: Db, ids: string[]): void {
  const affected = new Set<string>();
  let frontier = ids;
  while (frontier.length) {
    for (const id of frontier) affected.add(id);
    frontier = dependentsOf(tx, frontier)
      .map((it) => it.id)
      .filter((id) => !affected.has(id));
  }
  // What each waits on: its matches that may move too.
  const waitsOn = new Map([...affected].map((id) => [id, new Set<string>()]));
  const edges = affected.size
    ? tx
        .select({ itemId: itemSmartMatches.itemId, anchorId: itemSmartMatches.anchorId })
        .from(itemSmartMatches)
        .where(
          and(
            inArray(itemSmartMatches.itemId, [...affected]),
            inArray(itemSmartMatches.anchorId, [...affected]),
            eq(itemSmartMatches.removed, false),
          ),
        )
        .all()
    : [];
  for (const e of edges) waitsOn.get(e.itemId)?.add(e.anchorId);
  while (waitsOn.size) {
    const ready = [...waitsOn].filter(([, w]) => w.size === 0).map(([id]) => id);
    // addSmartMatch refuses loops, so this can't happen; never spin on one.
    if (ready.length === 0) throw new Error("smart due dates hang off each other in a loop");
    for (const id of ready) {
      waitsOn.delete(id);
      for (const w of waitsOn.values()) w.delete(id);
      // Read now, after what it hangs off has moved.
      const item = tx.select().from(items).where(eq(items.id, id)).get();
      if (!item || item.smartRule === null || item.completedAt !== null) continue;
      const changes = applySmartDue(tx, item, item.smartLead ?? 0);
      if (!changes) continue;
      recordAudit(tx, {
        actor: SYSTEM_ACTOR,
        source: "system",
        event: { type: "item.updated", itemId: item.id, title: item.title, projectId: item.projectId, changes },
      });
    }
  }
}

/** The smart items matched to `anchorIds`, before they're deleted, to recalibrate after. */
export function smartDependents(tx: Db, anchorIds: string[]): string[] {
  return dependentsOf(tx, anchorIds).map((it) => it.id);
}

/** Whether `itemId` hangs off `anchorId`, directly or through other matches. */
function dependsOn(db: Db, itemId: string, anchorId: string): boolean {
  const seen = new Set<string>();
  let frontier = [anchorId];
  while (frontier.length) {
    if (frontier.includes(itemId)) return true;
    for (const id of frontier) seen.add(id);
    frontier = db
      .select({ id: itemSmartMatches.anchorId })
      .from(itemSmartMatches)
      .where(and(inArray(itemSmartMatches.itemId, frontier), eq(itemSmartMatches.removed, false)))
      .all()
      .map((r) => r.id)
      .filter((id) => !seen.has(id));
  }
  return false;
}

function editableItem(db: Db, userId: string, itemId: string): Item {
  const item = visibleItem(db, userId, itemId);
  if (!item) throw new Error(`item not found: ${itemId}`);
  requireListAccess(db, userId, item.projectId, "edit");
  return item;
}

/** The item.updated event for a change to `item`. */
function updated(item: Item, changes: ItemChanges) {
  return { type: "item.updated" as const, itemId: item.id, title: item.title, projectId: item.projectId, changes };
}

/** The item as it is after a change `userId` just made to it. */
function after(db: Db, userId: string, itemId: string): Item {
  const item = visibleItem(db, userId, itemId);
  if (!item) throw new Error(`item not found: ${itemId}`);
  return item;
}

/**
 * Give an item a smart due date, change its rule or lead, or (null) make it
 * a plain one again, keeping the date it has and forgetting its matches.
 * Its date is worked out at once from the matches it has.
 */
export function setSmartRule(
  db: Db,
  userId: string,
  itemId: string,
  input: SmartRule | null,
  source: AuditOrigin,
): Item {
  const item = editableItem(db, userId, itemId);
  const rule = input && assertRule(input);
  if (rule && item.repeatUnit) throw new Error("a repeating item can't have a smart due date yet");
  if (rule ? rule.rule === item.smartRule && rule.lead === item.smartLead : item.smartRule === null) {
    return item;
  }
  db.transaction((tx) => {
    const t = tx as unknown as Db;
    // A rule plans it, so it leaves Someday.
    const someday = rule && item.somedayAt !== null ? { someday: false } : {};
    tx.update(items)
      .set({ smartRule: rule?.rule ?? null, smartLead: rule?.lead ?? null, ...(rule && { somedayAt: null }) })
      .where(eq(items.id, item.id))
      .run();
    if (!rule) {
      tx.delete(itemSmartMatches).where(eq(itemSmartMatches.itemId, item.id)).run();
      recordAudit(t, { actor: userId, source, event: updated(item, { smart: null }) });
      return;
    }
    const moved = applySmartDue(t, item, rule.lead);
    recordAudit(t, { actor: userId, source, event: updated(item, { smart: rule, ...moved, ...someday }) });
    if (moved) recalibrate(t, [item.id]);
  });
  return after(db, userId, itemId);
}

/**
 * Match `anchorId` to a smart item, with why it fits (`reason`, null when
 * someone picked it). One someone removed before comes back. The anchor can
 * be any item the user can open, other than the item itself or one that
 * already hangs off it.
 */
export function addSmartMatch(
  db: Db,
  userId: string,
  itemId: string,
  anchorId: string,
  reason: string | null,
  source: AuditOrigin,
): Item {
  const item = editableItem(db, userId, itemId);
  if (item.smartRule === null) throw new Error("the item doesn't have a smart due date");
  const anchor = visibleItem(db, userId, anchorId);
  if (!anchor) throw new Error(`item not found: ${anchorId}`);
  if (anchor.id === item.id) throw new Error("an item can't be its own match");
  if (dependsOn(db, item.id, anchor.id)) {
    throw new Error("that item's due date already comes from this one");
  }
  const existing = db
    .select({ removed: itemSmartMatches.removed })
    .from(itemSmartMatches)
    .where(and(eq(itemSmartMatches.itemId, item.id), eq(itemSmartMatches.anchorId, anchor.id)))
    .get();
  if (existing && !existing.removed) return item;
  const why = reason?.trim() || null;
  db.transaction((tx) => {
    const t = tx as unknown as Db;
    tx.insert(itemSmartMatches)
      .values({ itemId: item.id, anchorId: anchor.id, reason: why, createdAt: Date.now() })
      .onConflictDoUpdate({
        target: [itemSmartMatches.itemId, itemSmartMatches.anchorId],
        set: { removed: false, reason: why },
      })
      .run();
    const moved = applySmartDue(t, item, item.smartLead ?? 0);
    recordAudit(t, { actor: userId, source, event: updated(item, { matched: anchorAt(anchor), ...moved }) });
    if (moved) recalibrate(t, [item.id]);
  });
  return after(db, userId, itemId);
}

/**
 * Say a match isn't one. It's kept as removed, so it isn't matched again,
 * and the date is worked out from the rest.
 */
export function removeSmartMatch(
  db: Db,
  userId: string,
  itemId: string,
  anchorId: string,
  source: AuditOrigin,
): Item {
  const item = editableItem(db, userId, itemId);
  // Its title is for the log; whoever removes it may not see its list.
  const anchor = db
    .select({ id: items.id, title: items.title, projectId: items.projectId })
    .from(itemSmartMatches)
    .innerJoin(items, eq(items.id, itemSmartMatches.anchorId))
    .where(
      and(
        eq(itemSmartMatches.itemId, item.id),
        eq(itemSmartMatches.anchorId, anchorId),
        eq(itemSmartMatches.removed, false),
      ),
    )
    .get();
  if (!anchor) return item;
  db.transaction((tx) => {
    const t = tx as unknown as Db;
    tx.update(itemSmartMatches)
      .set({ removed: true })
      .where(and(eq(itemSmartMatches.itemId, item.id), eq(itemSmartMatches.anchorId, anchorId)))
      .run();
    const moved = applySmartDue(t, item, item.smartLead ?? 0);
    recordAudit(t, { actor: userId, source, event: updated(item, { unmatched: anchorAt(anchor), ...moved }) });
    if (moved) recalibrate(t, [item.id]);
  });
  return after(db, userId, itemId);
}

/** A match as `userId` may see it: an item in a list they can't open has no title or ref. */
export interface SmartMatchView {
  anchorId: string;
  title: string | null;
  ref: string | null;
  due: DueAt;
  done: boolean;
  reason: string | null;
  /** The match the date comes from now. */
  current: boolean;
}

export interface SmartDueView {
  rule: string;
  lead: number;
  /** Earliest to start first; undated ones last. */
  matches: SmartMatchView[];
}

/** A smart item's rule and matches, or null when its date isn't smart. */
export function getSmartDue(db: Db, userId: string, itemId: string): SmartDueView | null {
  const item = visibleItem(db, userId, itemId);
  if (!item || item.smartRule === null) return null;
  const current = currentAnchor(db, item.id)?.id;
  const rows = db
    .select({ items, prefix: projects.prefix, reason: itemSmartMatches.reason })
    .from(itemSmartMatches)
    .innerJoin(items, eq(items.id, itemSmartMatches.anchorId))
    .innerJoin(projects, eq(projects.id, items.projectId))
    .where(and(eq(itemSmartMatches.itemId, item.id), eq(itemSmartMatches.removed, false)))
    .orderBy(sql`${startDay} is null`, asc(startDay), asc(items.id))
    .all();
  const open = new Map<string, boolean>();
  const canOpen = (projectId: string) => {
    let can = open.get(projectId);
    if (can === undefined) open.set(projectId, (can = listAccess(db, userId, projectId) !== null));
    return can;
  };
  return {
    rule: item.smartRule,
    lead: item.smartLead ?? 0,
    matches: rows.map(({ items: a, prefix, reason }) => {
      const shown = canOpen(a.projectId);
      return {
        anchorId: a.id,
        title: shown ? a.title : null,
        ref: shown ? formatItemRef(prefix, a.number) : null,
        due: { dueDate: a.dueDate, dueFrom: a.dueFrom },
        done: a.completedAt !== null,
        reason: shown ? reason : null,
        current: a.id === current,
      };
    }),
  };
}

/** An item someone could match, found by title or ref. */
export interface SmartCandidate {
  id: string;
  title: string;
  ref: string;
  due: DueAt;
}

/**
 * Open items `userId` can see whose title has `query`, or whose ref it is,
 * to match to `itemId`: not itself, nor one matched already. Dated ones
 * first, soonest first.
 */
export function findSmartCandidates(db: Db, userId: string, itemId: string, query: string, limit = 8): SmartCandidate[] {
  editableItem(db, userId, itemId);
  const q = query.trim();
  if (!q) return [];
  const ref = /^([a-z]+)-(\d+)$/i.exec(q);
  const matched = db
    .select({ id: itemSmartMatches.anchorId })
    .from(itemSmartMatches)
    .where(and(eq(itemSmartMatches.itemId, itemId), eq(itemSmartMatches.removed, false)));
  return db
    .select({ items, prefix: projects.prefix })
    .from(items)
    .innerJoin(projects, eq(projects.id, items.projectId))
    .where(
      and(
        hasProjectAccess(userId),
        isNull(items.completedAt),
        ne(items.id, itemId),
        sql`${items.id} not in ${matched}`,
        or(
          sql`${items.title} like ${`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`} escape '\\'`,
          ref ? and(eq(projects.prefix, ref[1].toUpperCase()), eq(items.number, Number(ref[2]))) : undefined,
        ),
      ),
    )
    .orderBy(sql`${startDay} is null`, asc(startDay), asc(items.id))
    .limit(limit)
    .all()
    .map(({ items: it, prefix }) => ({
      id: it.id,
      title: it.title,
      ref: formatItemRef(prefix, it.number),
      due: { dueDate: it.dueDate, dueFrom: it.dueFrom },
    }));
}
