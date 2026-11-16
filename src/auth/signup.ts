import { eq } from "drizzle-orm";
import { users as authUsers } from "@/core/auth-schema";
import { getDb } from "@/core/db";
import { meta } from "@/core/schema";
import { getEnv } from "@/lib/env";

/** The meta row the first signup claims, locking signup after it. */
export const SIGNUP_LOCK_KEY = "signups_first_claimed";

/**
 * Whether to offer signup. Matches the gate in src/auth/better-auth.ts:
 * signup is open when the operator has set ALLOW_SIGNUP=true, or no users
 * exist yet (the very first boot, where the first signup claims any
 * pre-existing 'me' data) and no signup has claimed that first place. A
 * claim whose user was never written still locks signup until the next
 * boot clears it, so it counts here too.
 */
export function isSignUpOpen(): boolean {
  if (getEnv().ALLOW_SIGNUP) return true;
  const { db } = getDb();
  if (db.select({ id: authUsers.id }).from(authUsers).limit(1).get()) return false;
  return !db.select({ key: meta.key }).from(meta).where(eq(meta.key, SIGNUP_LOCK_KEY)).get();
}
