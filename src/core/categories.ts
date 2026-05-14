import { and, asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "./db";
import { type Category, categories } from "./schema";

export function listCategories(db: Db, projectId: string): Category[] {
  return db
    .select()
    .from(categories)
    .where(eq(categories.projectId, projectId))
    .orderBy(asc(categories.name))
    .all();
}

/**
 * Insert if missing. Used by addItem/updateItem to auto-register a category
 * the user typed inline.
 */
export function ensureCategory(
  db: Db,
  projectId: string,
  name: string,
): Category {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("category name required");
  const existing = db
    .select()
    .from(categories)
    .where(and(eq(categories.projectId, projectId), eq(categories.name, trimmed)))
    .get();
  if (existing) return existing;
  const id = nanoid(12);
  db.insert(categories)
    .values({ id, projectId, name: trimmed })
    .run();
  return { id, projectId, name: trimmed };
}

export function addCategory(
  db: Db,
  projectId: string,
  name: string,
): Category {
  return ensureCategory(db, projectId, name);
}
