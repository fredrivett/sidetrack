import { eq } from "drizzle-orm";
import { users } from "./auth-schema";
import type { Db } from "./db";

/** The IANA timezone the user's browser last reported, or null. */
export function getTimeZone(db: Db, userId: string): string | null {
  return (
    db
      .select({ timeZone: users.timeZone })
      .from(users)
      .where(eq(users.id, userId))
      .get()?.timeZone ?? null
  );
}

/**
 * Save the timezone the user's browser reports, so agents work out "today"
 * the way the user's screen does. Not audited, deliberately: it's the device
 * reporting where it is, not something the user did, and logging every sync
 * would be noise (like ensureCategory). Saves the zone's canonical name and
 * rejects anything that isn't an IANA zone the runtime knows.
 */
export function setTimeZone(db: Db, userId: string, timeZone: string): void {
  let canonical: string;
  try {
    canonical = new Intl.DateTimeFormat("en", { timeZone }).resolvedOptions().timeZone;
  } catch {
    throw new Error(`unknown timezone: ${timeZone}`);
  }
  // Fixed offsets like "+05:00" parse too, but they aren't zones: no DST.
  if (/^[+-]/.test(canonical)) throw new Error(`unknown timezone: ${timeZone}`);
  db.update(users).set({ timeZone: canonical }).where(eq(users.id, userId)).run();
}
