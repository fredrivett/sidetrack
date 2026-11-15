import { and, asc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { hasProjectAccess } from "./access";
import { users } from "./auth-schema";
import { type AuditOrigin, recordAudit, SYSTEM_ACTOR } from "./audit";
import { ensureCategory } from "./categories";
import type { Db } from "./db";
import { getTimeZone } from "./users";
import {
  MAX_REPEAT_EVERY,
  nextDue,
  type Repeat,
  REPEAT_UNITS,
  repeatLabel,
  repeatOf,
} from "../lib/repeat";
import { dayOf, isDay, sameDue } from "../lib/time";
import { parseRef, resolvePosition } from "./fracidx";
import { agentSessions, type Item, items, projects } from "./schema";

// Items are accessed transitively through their project. Every read joins the
// projects table so a user only ever sees items in projects they have access
// to (owner or member, via hasProjectAccess), and every write that takes an
// existing item id goes through getItem() which applies the same join.

// itemId is required, not optional: a falsy guard here once let an empty
// string drop the id filter and match an arbitrary accessible item. The only
// caller always has an id, so require it and always filter on it.
function accessibleItemWhere(userId: string, itemId: string) {
  return and(hasProjectAccess(userId), eq(items.id, itemId));
}

function accessibleProjectWhere(userId: string, projectId: string) {
  return and(eq(projects.id, projectId), hasProjectAccess(userId));
}

function projectAccessibleForUser(
  db: Db,
  userId: string,
  projectId: string,
): boolean {
  const row = db
    .select({ id: projects.id })
    .from(projects)
    .where(accessibleProjectWhere(userId, projectId))
    .get();
  return !!row;
}

export function listItems(
  db: Db,
  userId: string,
  projectId: string,
  opts: { includeCompleted?: boolean } = {},
): Item[] {
  const baseConds = [
    eq(items.projectId, projectId),
    hasProjectAccess(userId),
  ];
  if (!opts.includeCompleted) baseConds.push(isNull(items.completedAt));
  return db
    .select({ items })
    .from(items)
    .innerJoin(projects, eq(projects.id, items.projectId))
    .where(and(...baseConds))
    .orderBy(asc(items.position), asc(items.id))
    .all()
    .map((row) => row.items);
}

// Positions are scoped to a parent: top-level items order among themselves,
// and each parent's sub-items order among themselves.
function getAllSiblings(
  db: Db,
  userId: string,
  projectId: string,
  parentId: string | null,
): Item[] {
  return db
    .select({ items })
    .from(items)
    .innerJoin(projects, eq(projects.id, items.projectId))
    .where(
      and(
        eq(items.projectId, projectId),
        parentId ? eq(items.parentId, parentId) : isNull(items.parentId),
        hasProjectAccess(userId),
      ),
    )
    .orderBy(asc(items.position), asc(items.id))
    .all()
    .map((row) => row.items);
}

// Title is NOT NULL in the schema, but blank is just as broken as null —
// an item with no title is unusable. Reject it at the boundary so neither the
// web UI nor an MCP tool can persist one, and return the trimmed value.
function assertTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) throw new Error("item title cannot be empty");
  return trimmed;
}

// A due date is a calendar day, "YYYY-MM-DD"; blank clears it.
function assertDueDate(due: string | null | undefined): string | null {
  const d = due?.trim() || null;
  if (d && !isDay(d)) throw new Error(`invalid due date: ${d} (expected YYYY-MM-DD)`);
  return d;
}

// A due date, or a span from dueFrom to dueDate. A span of one day is stored
// as that day alone, so each due has one form.
function assertDue(
  dueDate: string | null | undefined,
  dueFrom: string | null | undefined,
): { dueDate: string | null; dueFrom: string | null } {
  const to = assertDueDate(dueDate);
  const from = assertDueDate(dueFrom);
  if (from && !to) throw new Error("a due span needs a due date as its last day");
  if (from && to && from > to) {
    throw new Error(`invalid due span: ${from} is after its due date ${to}`);
  }
  return { dueDate: to, dueFrom: from === to ? null : from };
}

function dueText(due: { dueDate: string | null; dueFrom: string | null }): string {
  return due.dueFrom ? `${due.dueFrom} to ${due.dueDate}` : (due.dueDate ?? "");
}

// A repeat rule is a whole number of days, weeks or months; null clears it.
function assertRepeat(repeat: Repeat | null): Repeat | null {
  if (!repeat) return null;
  const { every, unit } = repeat;
  if (!(REPEAT_UNITS as readonly string[]).includes(unit)) {
    throw new Error(`invalid repeat unit: ${unit} (expected day, week or month)`);
  }
  if (!Number.isInteger(every) || every < 1 || every > MAX_REPEAT_EVERY) {
    throw new Error(`invalid repeat: every ${every} (expected 1 to ${MAX_REPEAT_EVERY})`);
  }
  return { every, unit };
}

/** An item's sub-items, in order, for a user who can see the item. */
export function listSubItems(db: Db, userId: string, parentId: string): Item[] {
  return db
    .select({ items })
    .from(items)
    .innerJoin(projects, eq(projects.id, items.projectId))
    .where(and(eq(items.parentId, parentId), hasProjectAccess(userId)))
    .orderBy(asc(items.position), asc(items.id))
    .all()
    .map((row) => row.items);
}

function childrenOf(db: Db, parentId: string): Item[] {
  return db
    .select()
    .from(items)
    .where(eq(items.parentId, parentId))
    .orderBy(asc(items.position), asc(items.id))
    .all();
}

/**
 * Check that `parent` can take a sub-item in `projectId`. Checklists are one
 * level deep.
 */
function assertCanParent(parent: Item, projectId: string) {
  if (parent.projectId !== projectId) {
    throw new Error("a sub-item must be in the same list as its parent");
  }
  if (parent.parentId !== null) {
    throw new Error(`"${parent.title}" is already a sub-item; sub-items can't have their own`);
  }
}

/**
 * A finished parent never has open sub-items (completing a parent ticks them
 * all), so adding or reopening a sub-item reopens a finished parent with it.
 * Call inside the caller's transaction. The update is conditional, so the
 * parent's state is read inside the transaction rather than from a snapshot,
 * and the reopen is logged only when it actually happened.
 */
function reopenParentIfDone(
  tx: Db,
  userId: string,
  parent: Item,
  source: AuditOrigin,
) {
  // audit-exempt: runs inside the caller's transaction and audits the
  // reopen itself, below.
  const { changes } = tx
    .update(items)
    .set({ completedAt: null })
    .where(and(eq(items.id, parent.id), isNotNull(items.completedAt)))
    .run();
  if (changes === 0) return;
  recordAudit(tx, {
    actor: userId,
    source,
    action: "uncomplete",
    entityType: "item",
    entityId: parent.id,
    projectId: parent.projectId,
    detail: `reopened "${parent.title}" for an open sub-item`,
  });
}

// Human-readable label for an assignee in an audit detail: their `@username`,
// falling back to name, email, then the raw id (a removed/unknown user).
export function assigneeLabel(db: Db, id: string): string {
  const u = db
    .select({
      username: users.username,
      name: users.name,
      email: users.email,
    })
    .from(users)
    .where(eq(users.id, id))
    .get();
  return u?.username ? `@${u.username}` : (u?.name ?? u?.email ?? id);
}

export function addItem(
  db: Db,
  userId: string,
  input: {
    projectId: string;
    title: string;
    description?: string | null;
    category?: string | null;
    positionRef?: string;
    parentId?: string | null;
    dueDate?: string | null;
    /** The first day of a span ending on dueDate, such as this week's Monday. */
    dueFrom?: string | null;
    /** Who it's assigned to; several people make a joint item. */
    assigneeIds?: string[];
    /** Create it already done, e.g. to log something the user just finished. */
    completed?: boolean;
    repeat?: Repeat | null;
    /** Titles of sub-items to create under it, in order, in the same transaction. */
    subItems?: string[];
  },
  source: AuditOrigin,
): Item {
  const due = assertDue(input.dueDate, input.dueFrom);
  const repeat = assertRepeat(input.repeat ?? null);
  if (!projectAccessibleForUser(db, userId, input.projectId)) {
    throw new Error(`list not found: ${input.projectId}`);
  }
  const assigneeIds = [...new Set((input.assigneeIds ?? []).filter(Boolean))];
  for (const a of assigneeIds) {
    if (!projectAccessibleForUser(db, a, input.projectId)) {
      throw new Error(`assignee does not have access to the list: ${a}`);
    }
  }
  let parent: Item | null = null;
  if (input.parentId) {
    parent = getItem(db, userId, input.parentId) ?? null;
    if (!parent) throw new Error(`item not found: ${input.parentId}`);
    assertCanParent(parent, input.projectId);
  }
  const ref = parseRef(input.positionRef);
  const siblings = getAllSiblings(
    db,
    userId,
    input.projectId,
    parent?.id ?? null,
  );
  const position = resolvePosition(siblings, ref);
  const category = input.category?.trim() || null;
  const description = input.description?.trim() || null;
  const title = assertTitle(input.title);
  const id = nanoid(12);
  const now = Date.now();

  db.transaction((tx) => {
    if (category) ensureCategory(tx as unknown as Db, input.projectId, category);
    // Bump the project's counter and read the new value back in one atomic
    // statement, so the allocated number can't drift and we avoid a separate
    // read-modify-write. Monotonic — a deleted item's number is never reused.
    // Access was already verified above, so filter on the project id alone.
    const seqRow = tx
      .update(projects)
      .set({ itemSeq: sql`${projects.itemSeq} + 1` })
      .where(eq(projects.id, input.projectId))
      .returning({ seq: projects.itemSeq })
      .get();
    const number = seqRow?.seq ?? 1;
    tx.insert(items)
      .values({
        id,
        projectId: input.projectId,
        title,
        description,
        category,
        parentId: parent?.id ?? null,
        ...due,
        assigneeIds,
        repeatEvery: repeat?.every ?? null,
        repeatUnit: repeat?.unit ?? null,
        position,
        number,
        createdAt: now,
        completedAt: input.completed ? now : null,
      })
      .run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      action: "create",
      entityType: "item",
      entityId: id,
      projectId: input.projectId,
      detail:
        (parent
          ? `added "${title}" to "${parent.title}"`
          : `added task "${title}"`) +
        (due.dueDate ? `, due ${dueText(due)}` : "") +
        (assigneeIds.length
          ? `, assigned to ${assigneeIds.map((a) => assigneeLabel(tx as unknown as Db, a)).join(", ")}`
          : "") +
        (repeat ? `, repeats ${repeatLabel(repeat).toLowerCase()}` : ""),
    });
    // Created done: log the completion as its own row, as completeItem does,
    // so the item's history reads the same as adding it then ticking it.
    if (input.completed) {
      recordAudit(tx as unknown as Db, {
        actor: userId,
        source,
        action: "complete",
        entityType: "item",
        entityId: id,
        projectId: input.projectId,
        detail: `completed "${title}"`,
      });
    }
    // A done sub-item doesn't contradict a finished parent; only an open one does.
    if (parent && !input.completed) {
      reopenParentIfDone(tx as unknown as Db, userId, parent, source);
    }
    // Each sub-item is added and logged as if added on its own afterwards, and
    // shares the item's done state; one bad title rolls back the lot.
    for (const subTitle of input.subItems ?? []) {
      addItem(
        tx as unknown as Db,
        userId,
        { projectId: input.projectId, title: subTitle, parentId: id, completed: input.completed },
        source,
      );
    }
  });

  return getItemOrThrow(db, userId, id);
}

export function getItem(db: Db, userId: string, id: string): Item | undefined {
  return db
    .select({ items })
    .from(items)
    .innerJoin(projects, eq(projects.id, items.projectId))
    .where(accessibleItemWhere(userId, id))
    .get()?.items;
}

/**
 * Read an item back after a mutation that just created or updated it inside the
 * same transaction. The row is guaranteed to exist; a miss means an invariant
 * broke, so fail loudly rather than handing back `undefined`.
 */
function getItemOrThrow(db: Db, userId: string, id: string): Item {
  const item = getItem(db, userId, id);
  if (!item) throw new Error(`item not found: ${id}`);
  return item;
}

export function updateItem(
  db: Db,
  userId: string,
  id: string,
  patch: {
    title?: string;
    description?: string | null;
    category?: string | null;
    /** Everyone it's assigned to, replacing who it had; [] unassigns everyone. */
    assigneeIds?: string[];
    /** People to add or take off, leaving anyone else as they are now. */
    addAssigneeIds?: string[];
    removeAssigneeIds?: string[];
    /** Sets the due date; without dueFrom, it's due on that day alone. */
    dueDate?: string | null;
    /**
     * The first day of a span ending on dueDate. Alone, it moves the start of
     * the span to the current due date; null makes that a single day.
     */
    dueFrom?: string | null;
    repeat?: Repeat | null;
  },
  source: AuditOrigin,
): Item {
  const existing = getItem(db, userId, id);
  if (!existing) throw new Error(`item not found: ${id}`);

  const next: Partial<Item> = {};
  const changes: string[] = [];
  if (patch.title !== undefined) {
    const title = assertTitle(patch.title);
    if (title !== existing.title) {
      next.title = title;
      changes.push(`renamed to "${title}"`);
    }
  }
  if (patch.description !== undefined) {
    const d = patch.description?.trim() || null;
    if (d !== existing.description) {
      next.description = d;
      changes.push(d ? "edited description" : "description cleared");
    }
  }
  if (patch.category !== undefined) {
    const c = patch.category?.trim() || null;
    if (c !== existing.category) {
      next.category = c;
      changes.push(c ? `category → ${c}` : "category cleared");
    }
  }
  if (
    patch.assigneeIds !== undefined ||
    patch.addAssigneeIds !== undefined ||
    patch.removeAssigneeIds !== undefined
  ) {
    // A whole set replaces the old one. Adds and removes apply to the set as
    // it is now, so two people changing assignees from screens that haven't
    // caught up with each other don't undo each other's changes.
    const base = (patch.assigneeIds ?? existing.assigneeIds).filter(
      (a) => !patch.removeAssigneeIds?.includes(a),
    );
    const ids = [...new Set([...base, ...(patch.addAssigneeIds ?? [])].filter(Boolean))];
    // An assignee must have access to the project (be its owner or an accepted
    // member). projectAccessibleForUser is exactly that predicate applied to
    // the assignee rather than the caller.
    for (const a of ids) {
      if (!projectAccessibleForUser(db, a, existing.projectId)) {
        throw new Error(`assignee does not have access to the list: ${a}`);
      }
    }
    // Order isn't meaningful, so the same people in another order is a no-op.
    const added = ids.filter((a) => !existing.assigneeIds.includes(a));
    const removed = existing.assigneeIds.filter((a) => !ids.includes(a));
    if (added.length || removed.length) {
      next.assigneeIds = ids;
      const names = (list: string[]) =>
        list.map((a) => assigneeLabel(db, a)).join(", ");
      if (added.length) changes.push(`assigned ${names(added)}`);
      if (removed.length) changes.push(`unassigned ${names(removed)}`);
    }
  }
  if (patch.dueDate !== undefined || patch.dueFrom !== undefined) {
    // dueFrom alone moves the span's start (null: due on its due date alone).
    const d = assertDue(
      patch.dueDate === undefined ? existing.dueDate : patch.dueDate,
      patch.dueFrom,
    );
    if (d.dueDate !== existing.dueDate || d.dueFrom !== existing.dueFrom) {
      Object.assign(next, d);
      changes.push(d.dueDate ? `due ${dueText(d)}` : "due date cleared");
    }
  }
  if (patch.repeat !== undefined) {
    const r = assertRepeat(patch.repeat);
    const was = repeatOf(existing);
    if (r?.every !== was?.every || r?.unit !== was?.unit) {
      next.repeatEvery = r?.every ?? null;
      next.repeatUnit = r?.unit ?? null;
      changes.push(r ? `repeats ${repeatLabel(r).toLowerCase()}` : "no longer repeats");
    }
  }
  if (Object.keys(next).length === 0) return existing;

  db.transaction((tx) => {
    if (next.category) {
      ensureCategory(tx as unknown as Db, existing.projectId, next.category);
    }
    tx.update(items).set(next).where(eq(items.id, id)).run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      action: "update",
      entityType: "item",
      entityId: id,
      projectId: existing.projectId,
      detail: `${existing.title}: ${changes.join(", ")}`,
    });
  });

  return getItemOrThrow(db, userId, id);
}

export function completeItem(
  db: Db,
  userId: string,
  id: string,
  source: AuditOrigin,
): Item {
  const existing = getItem(db, userId, id);
  if (!existing) throw new Error(`item not found: ${id}`);
  if (existing.completedAt !== null) return existing;

  // Completing never moves the item: it keeps its place in the list, and the
  // UI decides how to show it (crossed out today, in Done after that).
  // Completing a parent ticks its open sub-items too, and ticking a parent's
  // last open sub-item completes the parent, each logged on its own so every
  // item's history says when it was done.
  const now = Date.now();
  db.transaction((tx) => {
    const parent = existing.parentId
      ? getItem(tx as unknown as Db, userId, existing.parentId)
      : undefined;
    // Read inside the transaction, so a sub-item added meanwhile counts.
    const openChildren = childrenOf(tx as unknown as Db, id).filter(
      (c) => c.completedAt === null,
    );
    const parentDone =
      parent &&
      parent.completedAt === null &&
      childrenOf(tx as unknown as Db, parent.id).every(
        (c) => c.id === id || c.completedAt !== null,
      );
    for (const it of [existing, ...openChildren, ...(parentDone ? [parent] : [])]) {
      tx.update(items).set({ completedAt: now }).where(eq(items.id, it.id)).run();
      // Finished work needs no agent: end any open sessions with the item.
      tx.update(agentSessions)
        .set({ finishedAt: now })
        .where(and(eq(agentSessions.itemId, it.id), isNull(agentSessions.finishedAt)))
        .run();
      recordAudit(tx as unknown as Db, {
        actor: userId,
        source,
        action: "complete",
        entityType: "item",
        entityId: it.id,
        projectId: existing.projectId,
        detail:
          it === existing
            ? `completed "${it.title}"`
            : it === parent
              ? `completed "${it.title}" with its last sub-item, "${existing.title}"`
              : `completed "${it.title}" with "${existing.title}"`,
      });
    }
  });
  return getItemOrThrow(db, userId, id);
}

export function uncompleteItem(
  db: Db,
  userId: string,
  id: string,
  source: AuditOrigin,
): Item {
  const existing = getItem(db, userId, id);
  if (!existing) throw new Error(`item not found: ${id}`);
  if (existing.completedAt === null) return existing;

  // Reopening returns it to the same place, since completing never moved it.
  // Reopening a sub-item reopens a finished parent, so it can't end up hidden
  // under a parent in Done. Reopening a parent leaves its sub-items as they are.
  const parent = existing.parentId ? getItem(db, userId, existing.parentId) : undefined;
  db.transaction((tx) => {
    if (parent) reopenParentIfDone(tx as unknown as Db, userId, parent, source);
    tx.update(items)
      .set({ completedAt: null })
      .where(eq(items.id, id))
      .run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      action: "uncomplete",
      entityType: "item",
      entityId: id,
      projectId: existing.projectId,
      detail: `reopened "${existing.title}"`,
    });
  });
  return getItemOrThrow(db, userId, id);
}

/**
 * Reopen the finished repeating items `userId` can see whose next due day has
 * come: the day the rule's gap after the day it was done, in `timeZone` (4am
 * turnover; the user's saved zone by default). Each reopens as the same item, in the same place, now due on
 * that day, along with its checklist. Archived lists are left alone.
 *
 * Called on read, at the start of each request that shows items (the board
 * and the MCP route), so whoever looks sees the reopened item; nothing needs
 * reopening while nobody is looking. Nobody made the change, so it's logged
 * with the `system` source. Each update only applies while the item is still
 * finished as it was read, so two requests at once can't both reopen it.
 * Returns how many items reopened.
 */
export function reopenDueRepeats(
  db: Db,
  userId: string,
  opts: { timeZone?: string; now?: number } = {},
): number {
  // The viewer's saved zone, as list_today uses; UTC until a browser reports one.
  const timeZone = opts.timeZone ?? getTimeZone(db, userId) ?? "UTC";
  const today = dayOf(opts.now ?? Date.now(), timeZone);
  const finished = db
    .select({ items })
    .from(items)
    .innerJoin(projects, eq(projects.id, items.projectId))
    .where(
      and(
        hasProjectAccess(userId),
        ne(projects.status, "archived"),
        isNotNull(items.repeatUnit),
        isNotNull(items.completedAt),
      ),
    )
    .all()
    .map((row) => row.items);

  let reopened = 0;
  for (const it of finished) {
    const rule = repeatOf(it);
    const done = it.completedAt;
    if (!rule || done === null) continue;
    // A week or weekend comes back as a span, from its first day.
    const next = nextDue(dayOf(done, timeZone), rule, it);
    if ((next.dueFrom ?? next.dueDate) > today) continue;
    db.transaction((tx) => {
      const parent = it.parentId
        ? tx.select().from(items).where(eq(items.id, it.parentId)).get()
        : undefined;
      // Under a finished parent that repeats, a sub-item waits and comes
      // round with the parent's checklist, so it can't reopen the parent
      // before the parent's own day.
      if (parent && parent.completedAt !== null && repeatOf(parent)) return;
      const { changes } = tx
        .update(items)
        .set({ completedAt: null, ...next })
        .where(and(eq(items.id, it.id), eq(items.completedAt, done)))
        .run();
      if (changes === 0) return;
      reopened++;
      recordAudit(tx as unknown as Db, {
        actor: SYSTEM_ACTOR,
        source: "system",
        action: "uncomplete",
        entityType: "item",
        entityId: it.id,
        projectId: it.projectId,
        detail: `reopened "${it.title}" (repeats ${repeatLabel(rule).toLowerCase()}), due ${dueText(next)}`,
      });
      // The checklist comes round with it. A sub-item that repeats waited
      // for this (see above), so it's due when its parent is.
      for (const child of childrenOf(tx as unknown as Db, it.id)) {
        if (child.completedAt === null) continue;
        const childDue = repeatOf(child)
          ? next
          : { dueDate: child.dueDate, dueFrom: child.dueFrom };
        tx.update(items)
          .set({ completedAt: null, ...childDue })
          .where(eq(items.id, child.id))
          .run();
        recordAudit(tx as unknown as Db, {
          actor: SYSTEM_ACTOR,
          source: "system",
          action: "uncomplete",
          entityType: "item",
          entityId: child.id,
          projectId: it.projectId,
          detail:
            `reopened "${child.title}" with "${it.title}"` +
            (sameDue(childDue, child) ? "" : `, due ${dueText(childDue)}`),
        });
      }
      if (parent) {
        reopenParentIfDone(tx as unknown as Db, SYSTEM_ACTOR, parent, "system");
      }
    });
  }
  return reopened;
}

export function reorderItem(
  db: Db,
  userId: string,
  id: string,
  refRaw: string,
  source: AuditOrigin,
): Item {
  const existing = getItem(db, userId, id);
  if (!existing) throw new Error(`item not found: ${id}`);
  const ref = parseRef(refRaw);
  const siblings = getAllSiblings(
    db,
    userId,
    existing.projectId,
    existing.parentId,
  ).filter((s) => s.id !== id);
  const position = resolvePosition(siblings, ref);
  db.transaction((tx) => {
    tx.update(items).set({ position }).where(eq(items.id, id)).run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      action: "reorder",
      entityType: "item",
      entityId: id,
      projectId: existing.projectId,
      detail: `reordered "${existing.title}"`,
    });
  });
  return getItemOrThrow(db, userId, id);
}

/** Ways to sort a list's items once, each in its one useful direction. */
export const ITEM_SORTS = {
  due: "due date",
  created: "date created",
  title: "name",
} as const;
export type ItemSort = keyof typeof ITEM_SORTS;

const byTitle = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

// Each compares two top-level items; the sort is stable, so ties keep the
// list's current order.
const COMPARE: Record<ItemSort, (a: Item, b: Item) => number> = {
  // Soonest first, a span by its last day; undated items last.
  due: (a, b) =>
    a.dueDate === b.dueDate
      ? 0
      : a.dueDate === null
        ? 1
        : b.dueDate === null
          ? -1
          : a.dueDate.localeCompare(b.dueDate),
  // Newest first.
  created: (a, b) => b.createdAt - a.createdAt,
  title: (a, b) => byTitle.compare(a.title, b.title),
};

/**
 * Give a list's top-level items new positions in `order`, in one transaction
 * with its audit row. Sub-items keep their positions, which order them only
 * among their siblings, so each checklist moves with its parent.
 */
function applyItemOrder(
  db: Db,
  userId: string,
  projectId: string,
  order: Item[],
  detail: string,
  source: AuditOrigin,
) {
  db.transaction((tx) => {
    const placed: Array<{ id: string; position: string }> = [];
    for (const item of order) {
      const position = resolvePosition(placed, "last");
      tx.update(items).set({ position }).where(eq(items.id, item.id)).run();
      placed.push({ id: item.id, position });
    }
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      action: "reorder",
      entityType: "project",
      entityId: projectId,
      projectId,
      detail,
    });
  });
}

function projectNameOrThrow(db: Db, userId: string, projectId: string): string {
  const row = db
    .select({ name: projects.name })
    .from(projects)
    .where(accessibleProjectWhere(userId, projectId))
    .get();
  if (!row) throw new Error(`list not found: ${projectId}`);
  return row.name;
}

const sameOrder = (a: Item[], b: Item[]) => a.every((item, i) => item.id === b[i]?.id);

/**
 * Sort a list's top-level items once, rewriting their order; dragging works
 * as before afterwards. Returns the ids in their order before the sort, for
 * setItemOrder to undo it, or null when they were already in that order and
 * nothing changed.
 */
export function sortItems(
  db: Db,
  userId: string,
  projectId: string,
  by: ItemSort,
  source: AuditOrigin,
): string[] | null {
  if (!Object.hasOwn(ITEM_SORTS, by)) throw new Error(`invalid sort: ${by}`);
  const name = projectNameOrThrow(db, userId, projectId);
  const current = getAllSiblings(db, userId, projectId, null);
  const sorted = current.toSorted(COMPARE[by]);
  if (sameOrder(sorted, current)) return null;
  applyItemOrder(db, userId, projectId, sorted, `sorted "${name}" by ${ITEM_SORTS[by]}`, source);
  return current.map((i) => i.id);
}

/**
 * Put a list's top-level items in the order of `ids`, such as the order
 * sortItems returned, to undo a sort. Ids no longer in the list are skipped,
 * and items added since go after the rest, in their current order.
 */
export function setItemOrder(
  db: Db,
  userId: string,
  projectId: string,
  ids: string[],
  source: AuditOrigin,
): void {
  const name = projectNameOrThrow(db, userId, projectId);
  const current = getAllSiblings(db, userId, projectId, null);
  const rank = new Map(ids.map((id, i) => [id, i]));
  const ordered = current.toSorted(
    (a, b) => (rank.get(a.id) ?? ids.length) - (rank.get(b.id) ?? ids.length),
  );
  if (sameOrder(ordered, current)) return;
  applyItemOrder(db, userId, projectId, ordered, `reordered the items in "${name}"`, source);
}

export function deleteItem(
  db: Db,
  userId: string,
  id: string,
  source: AuditOrigin,
): void {
  const existing = getItem(db, userId, id);
  if (!existing) return;
  // Sub-items go with their parent. Delete and log them explicitly rather than
  // leaving it to the foreign key's cascade, so each one's history ends.
  db.transaction((tx) => {
    const children = childrenOf(tx as unknown as Db, id);
    for (const it of [...children, existing]) {
      tx.delete(items).where(eq(items.id, it.id)).run();
      recordAudit(tx as unknown as Db, {
        actor: userId,
        source,
        action: "delete",
        entityType: "item",
        entityId: it.id,
        projectId: existing.projectId,
        detail:
          it === existing
            ? `deleted "${it.title}"`
            : `deleted "${it.title}" with "${existing.title}"`,
      });
    }
  });
}

/**
 * Make an item a sub-item of `parentId`, or move it back out to the top level
 * with null. Nesting puts it last among the parent's sub-items; moving out puts
 * it straight after its old parent. `positionRef` (top | end | after:<id> |
 * before:<id>, anchored on a sibling at the destination) places it elsewhere,
 * as a drop does. When the parent is unchanged this does nothing; moving within
 * one level is `reorderItem`.
 */
export function setItemParent(
  db: Db,
  userId: string,
  id: string,
  parentId: string | null,
  source: AuditOrigin,
  positionRef?: string,
): Item {
  const existing = getItem(db, userId, id);
  if (!existing) throw new Error(`item not found: ${id}`);
  if ((parentId || null) === existing.parentId) return existing;

  let parent: Item | null = null;
  let position: string;
  let detail: string;
  if (parentId) {
    if (parentId === id) throw new Error("an item can't be its own sub-item");
    parent = getItem(db, userId, parentId) ?? null;
    if (!parent) throw new Error(`item not found: ${parentId}`);
    assertCanParent(parent, existing.projectId);
    if (childrenOf(db, id).length > 0) {
      throw new Error(`"${existing.title}" has sub-items, so it can't become one`);
    }
    position = resolvePosition(
      getAllSiblings(db, userId, existing.projectId, parent.id),
      parseRef(positionRef),
    );
    detail = `made "${existing.title}" a sub-item of "${parent.title}"`;
  } else {
    const oldParent = existing.parentId
      ? getItem(db, userId, existing.parentId)
      : undefined;
    position = resolvePosition(
      getAllSiblings(db, userId, existing.projectId, null),
      positionRef !== undefined
        ? parseRef(positionRef)
        : oldParent
          ? { after: oldParent.id }
          : "last",
    );
    detail = `moved "${existing.title}" out of "${oldParent?.title ?? "its parent"}"`;
  }

  db.transaction((tx) => {
    tx.update(items)
      .set({ parentId: parent?.id ?? null, position })
      .where(eq(items.id, id))
      .run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      action: "update",
      entityType: "item",
      entityId: id,
      projectId: existing.projectId,
      detail,
    });
    if (parent && existing.completedAt === null) {
      reopenParentIfDone(tx as unknown as Db, userId, parent, source);
    }
  });
  return getItemOrThrow(db, userId, id);
}
