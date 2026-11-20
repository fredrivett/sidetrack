// Someone's note about their day, in their own words: how they feel, or
// what they want from it ("not feeling well", "keen to get through a lot").
// One per person per day, by their 4am turnover. The Agenda greeting is
// written with it (agendaBrief.ts), so Sidetrack can suggest a lighter or a
// fuller day; it only ever suggests. Per person and seen by nobody else, so
// not audited, like greeting prefs.

import { and, eq } from "drizzle-orm";
import { cleanNote } from "../lib/greetingPrefs";
import type { Db } from "./db";
import { dayNotes } from "./schema";

/** The user's note for `day` (YYYY-MM-DD), or null when they haven't written one. */
export function getDayNote(db: Db, userId: string, day: string): string | null {
  return (
    db
      .select({ text: dayNotes.text })
      .from(dayNotes)
      .where(and(eq(dayNotes.userId, userId), eq(dayNotes.day, day)))
      .get()?.text ?? null
  );
}

/**
 * Save the user's note for `day`, cleaned as greeting notes are (one line,
 * NOTE_MAX characters at most); an empty one removes it. Returns the note
 * as kept, or null when there's none.
 */
export function setDayNote(db: Db, userId: string, day: string, raw: string): string | null {
  const text = cleanNote(raw);
  const mine = and(eq(dayNotes.userId, userId), eq(dayNotes.day, day));
  if (!text) {
    // audit-exempt: one person's own note, seen by nobody else (see above).
    db.delete(dayNotes).where(mine).run();
    return null;
  }
  const updatedAt = Date.now();
  // audit-exempt: as above.
  db.insert(dayNotes)
    .values({ userId, day, text, updatedAt })
    .onConflictDoUpdate({ target: [dayNotes.userId, dayNotes.day], set: { text, updatedAt } })
    .run();
  return text;
}
