import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { resolve } from "node:path";
import { getDb } from "./db";
import { backfillItemPrefixes } from "./item-ref-backfill";
import { backfillUsernames } from "./username-backfill";

let migrated = false;

export function runMigrations() {
  if (migrated) return;
  const { sqlite, db } = getDb();

  // FK enforcement MUST be off while migrating. Drizzle runs every migration
  // inside one transaction, and table-rebuild migrations (the standard SQLite
  // "12-step" recreate, e.g. 0004) DROP and recreate parent tables. With FKs
  // on, `DROP TABLE projects` performs an implicit DELETE that fires
  // `ON DELETE CASCADE` and wipes items/categories. `PRAGMA foreign_keys` is
  // a no-op *inside* a transaction, so it must be toggled here — before
  // drizzle opens its own BEGIN — not in the migration SQL itself.
  sqlite.pragma("foreign_keys = OFF");
  try {
    migrate(db, {
      migrationsFolder: resolve(process.cwd(), "src/core/migrations"),
    });
    // Catch any referential damage a rebuild may have introduced while
    // enforcement was off, rather than silently carrying it forward.
    const violations = sqlite.pragma("foreign_key_check") as unknown[];
    if (violations.length > 0) {
      throw new Error(
        `migrations left ${violations.length} foreign-key violation(s)`,
      );
    }
  } finally {
    sqlite.pragma("foreign_keys = ON");
  }
  // Turn the 0005 placeholder usernames into real, de-duplicated handles.
  // Idempotent (only placeholder rows are touched), so safe on every boot.
  backfillUsernames(db);
  // Likewise turn the 0006 placeholder project prefixes into real, de-duplicated
  // ones derived from each project name. Idempotent for the same reason.
  backfillItemPrefixes(db);
  migrated = true;
}

if (typeof require !== "undefined" && require.main === module) {
  runMigrations();
  console.log("migrations applied");
}
