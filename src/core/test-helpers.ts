import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { resolve } from "node:path";
import * as schema from "./schema";

/**
 * Fresh in-memory SQLite DB with migrations applied. Use per test — do not
 * share across tests. Mirrors src/core/db.ts but bypasses the global singleton
 * and the file path, so tests are isolated and parallelisable.
 */
export function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, {
    migrationsFolder: resolve(process.cwd(), "src/core/migrations"),
  });
  return { sqlite, db };
}
