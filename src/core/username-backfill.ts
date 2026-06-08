import { asc, eq, like } from "drizzle-orm";
import {
  RESERVED_USERNAMES,
  USERNAME_MAX,
  deriveUsername,
} from "../lib/username";
import { users } from "./auth-schema";
import type { Db } from "./db";

// Migration 0005 backfills existing users with a placeholder username of
// `PLACEHOLDER_PREFIX + id` — guaranteed unique (id is the PK) and clearly not
// a real handle (`!` is outside the allowed charset, so no real username can
// start with it). This lets the column land NOT NULL + unique immediately,
// while the real, human-friendly derivation happens here in TS where Set-based
// de-duplication is trivially correct (a pure-SQL suffix scheme can produce a
// suffixed handle that collides with a different base, e.g. `bob`+2 vs `bob2`).
const PLACEHOLDER_PREFIX = "!";

/**
 * Replace placeholder usernames written by the 0005 migration with handles
 * derived from each user's email, de-duplicated against all existing handles.
 * Idempotent: only rows still holding a placeholder are touched, so this is a
 * no-op on every boot after the first. Called from runMigrations().
 */
export function backfillUsernames(db: Db): void {
  const pending = db
    .select()
    .from(users)
    .where(like(users.username, `${PLACEHOLDER_PREFIX}%`))
    // Deterministic order so collision suffixes are stable across runs.
    .orderBy(asc(users.createdAt), asc(users.id))
    .all();
  if (pending.length === 0) return;

  // Seed the taken set with reserved handles (so a backfill never assigns
  // `admin`, `settings`, etc. — the suffix loop bumps it to `admin2`) plus all
  // handles already finalized by real sign-ups (so we never steal a chosen one).
  const taken = new Set<string>(RESERVED_USERNAMES);
  for (const r of db.select({ username: users.username }).from(users).all()) {
    if (!r.username.startsWith(PLACEHOLDER_PREFIX)) {
      taken.add(r.username.toLowerCase());
    }
  }

  for (const user of pending) {
    const base = deriveUsername(user.email);
    let handle = base;
    let n = 2;
    while (taken.has(handle)) {
      const suffix = String(n);
      // Trim the base to make room for the suffix so a collision can never
      // persist a handle longer than the max (base is already <= max).
      handle = base.slice(0, USERNAME_MAX - suffix.length) + suffix;
      n += 1;
    }
    taken.add(handle);
    db.update(users)
      .set({ username: handle, displayUsername: handle })
      .where(eq(users.id, user.id))
      .run();
  }
}
