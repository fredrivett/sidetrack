import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { nanoid } from "nanoid";
import { resolve } from "node:path";
import * as appSchema from "./schema";
import * as authSchema from "./auth-schema";

// Mirror db.ts: the combined schema makes the test Db type match the one
// core functions are typed against (which now includes the auth tables).
const schema = { ...appSchema, ...authSchema };

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

/**
 * Insert a user row directly and return its id. Core reads/writes now require
 * a userId; tests use this to get a valid owner without spinning up Better
 * Auth. The projects.user_id / audit_log.actor columns have no FK to users,
 * but creating a real row keeps the api_keys FK (and any future ones) happy.
 */
export function createTestUser(
  db: ReturnType<typeof createTestDb>["db"],
  overrides: { email?: string; name?: string; username?: string } = {},
): string {
  const id = nanoid(12);
  const now = new Date();
  // username is NOT NULL + unique; derive a valid, collision-free default from
  // the (unique) id when the caller doesn't care. nanoid's alphabet includes
  // `-`, which isn't allowed in handles, so strip it.
  const username =
    overrides.username ?? `u${id.replace(/[^a-z0-9]/gi, "").toLowerCase()}`;
  db.insert(authSchema.users)
    .values({
      id,
      name: overrides.name ?? "Test User",
      email: overrides.email ?? `${id}@test.local`,
      emailVerified: false,
      username,
      displayUsername: username,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}
