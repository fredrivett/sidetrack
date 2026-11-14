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
 * would be noise (like ensureCategory). Rejects anything that isn't a zone the
 * runtime knows.
 */
export function setTimeZone(db: Db, userId: string, timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en", { timeZone });
  } catch {
    throw new Error(`unknown timezone: ${timeZone}`);
  }
  db.update(users).set({ timeZone }).where(eq(users.id, userId)).run();
}
