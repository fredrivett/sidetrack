import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { hasProjectAccess } from "./access";
import { users } from "./auth-schema";
import { recordAudit } from "./audit";
import { ensureCategory } from "./categories";
import type { Db } from "./db";
import {
  parseRef,
  resolveCompletePosition,
  resolveItemPosition,
  resolveUncompletePosition,
} from "./fracidx";
import {
  type AuditSource,
  type Item,
  type ItemKind,
  ITEM_KINDS,
  items,
  projects,
} from "./schema";

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
    .orderBy(asc(items.position))
    .all()
    .map((row) => row.items);
}

function getAllSiblings(db: Db, userId: string, projectId: string): Item[] {
  return db
    .select({ items })
    .from(items)
    .innerJoin(projects, eq(projects.id, items.projectId))
    .where(
      and(eq(items.projectId, projectId), hasProjectAccess(userId)),
    )
    .orderBy(asc(items.position))
    .all()
    .map((row) => row.items);
}

function assertKind(kind: string): asserts kind is ItemKind {
  if (!(ITEM_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`invalid kind: ${kind}`);
  }
}

// Title is NOT NULL in the schema, but blank is just as broken as null —
// an item with no title is unusable. Reject it at the boundary so neither the
// web UI nor an MCP tool can persist one, and return the trimmed value.
function assertTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) throw new Error("item title cannot be empty");
  return trimmed;
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
    kind: ItemKind;
    title: string;
    description?: string | null;
    category?: string | null;
    positionRef?: string;
  },
  source: AuditSource,
): Item {
  assertKind(input.kind);
  if (!projectAccessibleForUser(db, userId, input.projectId)) {
    throw new Error(`project not found: ${input.projectId}`);
  }
  const ref = parseRef(input.positionRef);
  const siblings = getAllSiblings(db, userId, input.projectId);
  const position = resolveItemPosition(siblings, ref);
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
        kind: input.kind,
        title,
        description,
        category,
        position,
        number,
        createdAt: now,
      })
      .run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      action: "create",
      entityType: "item",
      entityId: id,
      projectId: input.projectId,
      detail: `added ${input.kind} "${title}"`,
    });
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
  },
  source: AuditSource,
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
      throw new Error(`assignee does not have access to the project: ${a}`);
    }
    if (a !== existing.assigneeId) {
      next.assigneeId = a;
      changes.push(a ? `assigned to ${assigneeLabel(db, a)}` : "unassigned");
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
  source: AuditSource,
): Item {
  const existing = getItem(db, userId, id);
  if (!existing) throw new Error(`item not found: ${id}`);
  if (existing.completedAt !== null) return existing;

  const siblings = getAllSiblings(db, userId, existing.projectId);
  const position = resolveCompletePosition(siblings, id);
  db.transaction((tx) => {
    tx.update(items)
      .set({ completedAt: Date.now(), position })
      .where(eq(items.id, id))
      .run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      action: "complete",
      entityType: "item",
      entityId: id,
      projectId: existing.projectId,
      detail: `completed "${existing.title}"`,
    });
  });
  return getItemOrThrow(db, userId, id);
}

export function uncompleteItem(
  db: Db,
  userId: string,
  id: string,
  source: AuditSource,
): Item {
  const existing = getItem(db, userId, id);
  if (!existing) throw new Error(`item not found: ${id}`);
  if (existing.completedAt === null) return existing;

  const siblings = getAllSiblings(db, userId, existing.projectId);
  const position = resolveUncompletePosition(siblings, id);
  db.transaction((tx) => {
    tx.update(items)
      .set({ completedAt: null, position })
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
  source: AuditSource,
): Item {
  const existing = getItem(db, userId, id);
  if (!existing) throw new Error(`item not found: ${id}`);
  const ref = parseRef(refRaw);
  const siblings = getAllSiblings(db, userId, existing.projectId).filter(
    (s) => s.id !== id,
  );
  const position = resolveItemPosition(siblings, ref);
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
  source: AuditSource,
): void {
  const existing = getItem(db, userId, id);
  if (!existing) return;
  db.transaction((tx) => {
    tx.delete(items).where(eq(items.id, id)).run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      action: "delete",
      entityType: "item",
      entityId: id,
      projectId: existing.projectId,
      detail: `deleted "${existing.title}"`,
    });
  });
}
