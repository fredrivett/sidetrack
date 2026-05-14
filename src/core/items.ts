import { and, asc, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "./db";
import { ensureCategory } from "./categories";
import {
  parseRef,
  resolveCompletePosition,
  resolveItemPosition,
  resolveUncompletePosition,
} from "./fracidx";
import { type Item, type ItemKind, ITEM_KINDS, items } from "./schema";

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
    category?: string | null;
    positionRef?: string;
  },
): Item {
  assertKind(input.kind);
  const ref = parseRef(input.positionRef);
  const siblings = getAllSiblings(db, input.projectId);
  const position = resolveItemPosition(siblings, ref);
  const category = input.category?.trim() || null;
  const id = nanoid(12);
  const now = Date.now();

  db.transaction((tx) => {
    if (category) ensureCategory(tx as unknown as Db, input.projectId, category);
    tx.insert(items)
      .values({
        id,
        projectId: input.projectId,
        kind: input.kind,
        title: input.title.trim(),
        category,
        position,
        createdAt: now,
      })
      .run();
  });

  return getItem(db, id)!;
}

export function getItem(db: Db, id: string): Item | undefined {
  return db.select().from(items).where(eq(items.id, id)).get();
}

export function updateItem(
  db: Db,
  id: string,
  patch: { title?: string; category?: string | null },
): Item {
  const existing = getItem(db, id);
  if (!existing) throw new Error(`item not found: ${id}`);

  const next: Partial<Item> = {};
  if (patch.title !== undefined) next.title = patch.title.trim();
  if (patch.category !== undefined) {
    const c = patch.category?.trim() || null;
    next.category = c;
  }
  if (Object.keys(next).length === 0) return existing;

  db.transaction((tx) => {
    if (next.category) {
      ensureCategory(tx as unknown as Db, existing.projectId, next.category);
    }
    tx.update(items).set(next).where(eq(items.id, id)).run();
  });

  return getItem(db, id)!;
}

export function completeItem(db: Db, id: string): Item {
  const existing = getItem(db, id);
  if (!existing) throw new Error(`item not found: ${id}`);
  if (existing.completedAt !== null) return existing;

  const siblings = getAllSiblings(db, existing.projectId);
  const position = resolveCompletePosition(siblings, id);
  db.update(items)
    .set({ completedAt: Date.now(), position })
    .where(eq(items.id, id))
    .run();
  return getItem(db, id)!;
}

export function uncompleteItem(db: Db, id: string): Item {
  const existing = getItem(db, id);
  if (!existing) throw new Error(`item not found: ${id}`);
  if (existing.completedAt === null) return existing;

  const siblings = getAllSiblings(db, existing.projectId);
  const position = resolveUncompletePosition(siblings, id);
  db.update(items)
    .set({ completedAt: null, position })
    .where(eq(items.id, id))
    .run();
  return getItem(db, id)!;
}

export function reorderItem(db: Db, id: string, refRaw: string): Item {
  const existing = getItem(db, id);
  if (!existing) throw new Error(`item not found: ${id}`);
  const ref = parseRef(refRaw);
  const siblings = getAllSiblings(db, existing.projectId).filter(
    (s) => s.id !== id,
  );
  const position = resolveItemPosition(siblings, ref);
  db.update(items).set({ position }).where(eq(items.id, id)).run();
  return getItem(db, id)!;
}

export function deleteItem(db: Db, id: string): void {
  db.delete(items).where(eq(items.id, id)).run();
}
