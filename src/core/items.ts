import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { hasProjectAccess } from "./access";
import { users } from "./auth-schema";
import { type AuditOrigin, recordAudit } from "./audit";
import { ensureCategory } from "./categories";
import type { Db } from "./db";
import { isDay } from "../lib/time";
import { parseRef, resolvePosition } from "./fracidx";
import { type Item, items, projects } from "./schema";

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
function assigneeLabel(db: Db, id: string): string {
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
    assigneeId?: string | null;
    /** Create it already done, e.g. to log something the user just finished. */
    completed?: boolean;
  },
  source: AuditOrigin,
): Item {
  const dueDate = assertDueDate(input.dueDate);
  if (!projectAccessibleForUser(db, userId, input.projectId)) {
    throw new Error(`list not found: ${input.projectId}`);
  }
  const assigneeId = input.assigneeId || null;
  if (assigneeId && !projectAccessibleForUser(db, assigneeId, input.projectId)) {
    throw new Error(`assignee does not have access to the list: ${assigneeId}`);
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
        dueDate,
        assigneeId,
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
        (dueDate ? `, due ${dueDate}` : "") +
        (assigneeId ? `, assigned to ${assigneeLabel(tx as unknown as Db, assigneeId)}` : ""),
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
    assigneeId?: string | null;
    dueDate?: string | null;
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
  if (patch.assigneeId !== undefined) {
    const a = patch.assigneeId || null;
    // An assignee must have access to the project (be its owner or an accepted
    // member). projectAccessibleForUser is exactly that predicate applied to
    // the assignee rather than the caller.
    if (a && !projectAccessibleForUser(db, a, existing.projectId)) {
      throw new Error(`assignee does not have access to the list: ${a}`);
    }
    if (a !== existing.assigneeId) {
      next.assigneeId = a;
      changes.push(a ? `assigned to ${assigneeLabel(db, a)}` : "unassigned");
    }
  }
  if (patch.dueDate !== undefined) {
    const d = assertDueDate(patch.dueDate);
    if (d !== existing.dueDate) {
      next.dueDate = d;
      changes.push(d ? `due ${d}` : "due date cleared");
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
  // Completing a parent ticks its open sub-items too, each logged on its own
  // so every item's history says when it was done.
  const now = Date.now();
  db.transaction((tx) => {
    // Read inside the transaction, so a sub-item added meanwhile is ticked too.
    const openChildren = childrenOf(tx as unknown as Db, id).filter(
      (c) => c.completedAt === null,
    );
    for (const it of [existing, ...openChildren]) {
      tx.update(items).set({ completedAt: now }).where(eq(items.id, it.id)).run();
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
