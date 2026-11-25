// How someone's day went, written as they close it: moods (WRAP_UP_TAGS) and
// a few words, an accountability update for the people they share their
// day with. Kept beside the day's note (dayNotes.ts), never over it, so
// whoever follows their day sees both how it started and how it went. One
// per person per day, by their 4am turnover. Not audited, like day notes:
// nobody else sees it unless its writer shares their day with them and
// chose to include its words or its mood (sharedDayNote).

import { and, eq } from "drizzle-orm";
import { splitTagged, WRAP_UP_TAGS, type WrapUpTag } from "../lib/dayTags";
import { cleanNote } from "../lib/greetingPrefs";
import { announceChange } from "./changes";
import type { Db } from "./db";
import { dayWrapUps } from "./schema";

export interface WrapUp {
  text: string;
  /** When the day was closed, the first time. */
  closedAt: number;
}

/** A wrap-up as a viewer may see it: its words, its moods, or both, and when. */
export interface SeenWrapUp {
  note: string | null;
  mood: WrapUpTag[];
  closedAt: number;
}

/** The user's wrap-up for `day` (YYYY-MM-DD), or null when they haven't closed it. */
export function getWrapUp(db: Db, userId: string, day: string): WrapUp | null {
  return (
    db
      .select({ text: dayWrapUps.text, closedAt: dayWrapUps.closedAt })
      .from(dayWrapUps)
      .where(and(eq(dayWrapUps.userId, userId), eq(dayWrapUps.day, day)))
      .get() ?? null
  );
}

/**
 * Close the user's `day` with how it went, cleaned as day notes are; words
 * aren't needed to close it. Writing it again changes what it says, not
 * when the day was closed. Returns it as kept.
 */
export function closeDay(db: Db, userId: string, day: string, raw: string, now = Date.now()): WrapUp {
  const text = cleanNote(raw);
  // audit-exempt: one person's own words, seen only through a day share
  // they opted them into (see above). Announced, so a partner's Check-ins
  // shows it live.
  db.insert(dayWrapUps)
    .values({ userId, day, text, closedAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: [dayWrapUps.userId, dayWrapUps.day], set: { text, updatedAt: now } })
    .run();
  announceChange({ actor: userId, projectId: null });
  return getWrapUp(db, userId, day) as WrapUp;
}

/** What may be seen of `w`: its words when `words`, its moods when `mood`; null when neither. */
export function seenWrapUp(w: WrapUp | null, words: boolean, mood: boolean): SeenWrapUp | null {
  if (!w || (!words && !mood)) return null;
  const { tags, rest } = splitTagged(w.text, WRAP_UP_TAGS);
  return { note: words && rest ? rest : null, mood: mood ? tags : [], closedAt: w.closedAt };
}
