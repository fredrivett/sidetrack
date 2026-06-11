import { asc, eq, like } from "drizzle-orm";
import { derivePrefix, dedupePrefix } from "../lib/itemRef";
import type { Db } from "./db";
import { projects } from "./schema";

// Migration 0006 lands `projects.prefix` as a placeholder (`!` + id) so the
// NOT NULL + unique `(user_id, prefix)` index can bind immediately. This turns
// those placeholders into real, human-friendly prefixes derived from each
// project name, de-duplicated *per owner* — done in TS because Set-based dedup
// is trivially correct (a pure-SQL suffix scheme can emit a suffixed prefix
// that collides with a different base, e.g. `ENG`+2 vs an existing `ENG2`).
const PLACEHOLDER_PREFIX = "!";

/**
 * Replace placeholder prefixes written by the 0006 migration with prefixes
 * derived from each project's name, unique within the owner's namespace.
 * Idempotent: only rows still holding a placeholder are touched, so this is a
 * no-op on every boot after the first. Called from runMigrations().
 */
export function backfillItemPrefixes(db: Db): void {
  const pending = db
    .select()
    .from(projects)
    .where(like(projects.prefix, `${PLACEHOLDER_PREFIX}%`))
    // Deterministic order so collision suffixes are stable across runs.
    .orderBy(asc(projects.createdAt), asc(projects.id))
    .all();
  if (pending.length === 0) return;

  // Per-owner set of already-finalized (non-placeholder) prefixes, so a
  // backfilled prefix never steals one a real project already holds.
  const takenByUser = new Map<string, Set<string>>();
  for (const p of db
    .select({ userId: projects.userId, prefix: projects.prefix })
    .from(projects)
    .all()) {
    if (p.prefix.startsWith(PLACEHOLDER_PREFIX)) continue;
    let taken = takenByUser.get(p.userId);
    if (!taken) {
      taken = new Set();
      takenByUser.set(p.userId, taken);
    }
    taken.add(p.prefix);
  }

  for (const project of pending) {
    let taken = takenByUser.get(project.userId);
    if (!taken) {
      taken = new Set();
      takenByUser.set(project.userId, taken);
    }
    const prefix = dedupePrefix(derivePrefix(project.name), taken);
    taken.add(prefix);
    db.update(projects)
      .set({ prefix })
      .where(eq(projects.id, project.id))
      .run();
  }
}
