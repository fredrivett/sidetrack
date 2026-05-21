import { and, asc, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
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
} from "./schema";

export function listItems(
  db: Db,
  projectId: string,
  opts: { includeCompleted?: boolean } = {},
): Item[] {
  const where = opts.includeCompleted
    ? eq(items.projectId, projectId)
    : and(eq(items.projectId, projectId), isNull(items.completedAt));
  return db.select().from(items).where(where).orderBy(asc(items.position)).all();
}

function getAllSiblings(db: Db, projectId: string): Item[] {
  return db
    .select()
    .from(items)
    .where(eq(items.projectId, projectId))
    .orderBy(asc(items.position))
    .all();
}

function assertKind(kind: string): asserts kind is ItemKind {
  if (!(ITEM_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`invalid kind: ${kind}`);
  }
}

export function addItem(
  db: Db,
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
  const ref = parseRef(input.positionRef);
  const siblings = getAllSiblings(db, input.projectId);
  const position = resolveItemPosition(siblings, ref);
  const category = input.category?.trim() || null;
  const description = input.description?.trim() || null;
  const title = input.title.trim();
  const id = nanoid(12);
  const now = Date.now();

  db.transaction((tx) => {
    if (category) ensureCategory(tx as unknown as Db, input.projectId, category);
    tx.insert(items)
      .values({
        id,
        projectId: input.projectId,
        kind: input.kind,
        title,
        description,
        category,
        position,
        createdAt: now,
      })
      .run();
    recordAudit(tx as unknown as Db, {
      source,
      action: "create",
      entityType: "item",
      entityId: id,
      projectId: input.projectId,
      detail: `added ${input.kind} "${title}"`,
    });
  });

  return getItem(db, id)!;
}

export function getItem(db: Db, id: string): Item | undefined {
  return db.select().from(items).where(eq(items.id, id)).get();
}

export function updateItem(
  db: Db,
  id: string,
  patch: { title?: string; description?: string | null; category?: string | null },
  source: AuditSource,
): Item {
  const existing = getItem(db, id);
  if (!existing) throw new Error(`item not found: ${id}`);

  const next: Partial<Item> = {};
  const changes: string[] = [];
  if (patch.title !== undefined && patch.title.trim() !== existing.title) {
    next.title = patch.title.trim();
    changes.push(`renamed to "${next.title}"`);
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
  if (Object.keys(next).length === 0) return existing;

  db.transaction((tx) => {
    if (next.category) {
      ensureCategory(tx as unknown as Db, existing.projectId, next.category);
    }
    tx.update(items).set(next).where(eq(items.id, id)).run();
    recordAudit(tx as unknown as Db, {
      source,
      action: "update",
      entityType: "item",
      entityId: id,
      projectId: existing.projectId,
      detail: `${existing.title}: ${changes.join(", ")}`,
    });
  });

  return getItem(db, id)!;
}

export function completeItem(db: Db, id: string, source: AuditSource): Item {
  const existing = getItem(db, id);
  if (!existing) throw new Error(`item not found: ${id}`);
  if (existing.completedAt !== null) return existing;

  const siblings = getAllSiblings(db, existing.projectId);
  const position = resolveCompletePosition(siblings, id);
  db.transaction((tx) => {
    tx.update(items)
      .set({ completedAt: Date.now(), position })
      .where(eq(items.id, id))
      .run();
    recordAudit(tx as unknown as Db, {
      source,
      action: "complete",
      entityType: "item",
      entityId: id,
      projectId: existing.projectId,
      detail: `completed "${existing.title}"`,
    });
  });
  return getItem(db, id)!;
}

export function uncompleteItem(db: Db, id: string, source: AuditSource): Item {
  const existing = getItem(db, id);
  if (!existing) throw new Error(`item not found: ${id}`);
  if (existing.completedAt === null) return existing;

  const siblings = getAllSiblings(db, existing.projectId);
  const position = resolveUncompletePosition(siblings, id);
  db.transaction((tx) => {
    tx.update(items)
      .set({ completedAt: null, position })
      .where(eq(items.id, id))
      .run();
    recordAudit(tx as unknown as Db, {
      source,
      action: "uncomplete",
      entityType: "item",
      entityId: id,
      projectId: existing.projectId,
      detail: `reopened "${existing.title}"`,
    });
  });
  return getItem(db, id)!;
}

export function reorderItem(
  db: Db,
  id: string,
  refRaw: string,
  source: AuditSource,
): Item {
  const existing = getItem(db, id);
  if (!existing) throw new Error(`item not found: ${id}`);
  const ref = parseRef(refRaw);
  const siblings = getAllSiblings(db, existing.projectId).filter(
    (s) => s.id !== id,
  );
  const position = resolveItemPosition(siblings, ref);
  db.transaction((tx) => {
    tx.update(items).set({ position }).where(eq(items.id, id)).run();
    recordAudit(tx as unknown as Db, {
      source,
      action: "reorder",
      entityType: "item",
      entityId: id,
      projectId: existing.projectId,
      detail: `reordered "${existing.title}"`,
    });
  });
  return getItem(db, id)!;
}

export function deleteItem(db: Db, id: string, source: AuditSource): void {
  const existing = getItem(db, id);
  if (!existing) return;
  db.transaction((tx) => {
    tx.delete(items).where(eq(items.id, id)).run();
    recordAudit(tx as unknown as Db, {
      source,
      action: "delete",
      entityType: "item",
      entityId: id,
      projectId: existing.projectId,
      detail: `deleted "${existing.title}"`,
    });
  });
}
