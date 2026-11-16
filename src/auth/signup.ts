import { users as authUsers } from "@/core/auth-schema";
import { getDb } from "@/core/db";
import { getEnv } from "@/lib/env";

/**
 * Whether to offer signup. Matches the gate in src/auth/better-auth.ts:
 * signup is open when the operator has set ALLOW_SIGNUP=true, or no users
 * exist yet (the very first boot, where the first signup claims any
 * pre-existing 'me' data).
 */
export function isSignUpOpen(): boolean {
  if (getEnv().ALLOW_SIGNUP) return true;
  const { db } = getDb();
  return !db.select({ id: authUsers.id }).from(authUsers).limit(1).get();
}
