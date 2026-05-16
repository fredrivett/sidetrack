import { and, asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { recordAudit } from "./audit";
import type { Db } from "./db";
import { type AuditSource, type Category, categories } from "./schema";

export function listCategories(db: Db, projectId: string): Category[] {
  return db
    .select()
    .from(categories)
    .where(eq(categories.projectId, projectId))
    .orderBy(asc(categories.name))
    .all();
}

/**
 * Insert if missing. Low-level helper used by addItem/updateItem to
 * auto-register an inline category. Intentionally NOT audited on its own —
 * the parent item create/update is the meaningful logged event; auto-created
 * categories would just be noise. Explicit `addCategory` is audited.
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
  db.insert(categories).values({ id, projectId, name: trimmed }).run();
  return { id, projectId, name: trimmed };
}

export function addCategory(
  db: Db,
  projectId: string,
  name: string,
  source: AuditSource,
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
  db.transaction((tx) => {
    tx.insert(categories).values({ id, projectId, name: trimmed }).run();
    recordAudit(tx as unknown as Db, {
      source,
      action: "create",
      entityType: "category",
      entityId: id,
      projectId,
      detail: `added category "${trimmed}"`,
    });
  });
  return { id, projectId, name: trimmed };
}
