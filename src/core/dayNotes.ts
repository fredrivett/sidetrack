// Someone's note about their day, in their own words: how they feel, or
// what they want from it ("not feeling well", "keen to get through a lot").
// One per person per day, by their 4am turnover. The Agenda greeting is
// written with it (agendaBrief.ts), so Sidetrack can suggest a lighter or a
// fuller day; it only ever suggests. Per person and not audited, like
// greeting prefs: nobody else sees it unless its writer shares their day
// with someone and chooses to include its words or its mood (sharedDayNote).

import { and, eq, isNotNull, or } from "drizzle-orm";
import { cleanDayTag, dayTagsFor, MAX_OWN_DAY_TAGS, splitDayNote } from "../lib/dayTags";
import { cleanNote } from "../lib/greetingPrefs";
import { dayOf } from "../lib/time";
import { users } from "./auth-schema";
import type { Db } from "./db";
import { validZone } from "./db-functions";
import { getWrapUp, type SeenWrapUp, seenWrapUp } from "./dayWrapUps";
import { dayNotes, dayShares, projectMembers, spaceMembers } from "./schema";

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
    // audit-exempt: one person's own note, seen only through a day share
    // they opted it into (see above). Not announced: a partner's Check-ins
    // picks it up on their next reload.
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

/** The user's own day tags, kept from Claude's suggestions, and the ones they took off. */
export interface MyDayTags {
  own: string[];
  removed: string[];
}

// Taken off, remembered at most, so Claude stops suggesting them; the oldest go first.
const MAX_REMOVED = 50;

/** The user's own day tags, read leniently: anything that isn't a tag is dropped. */
export function getDayTags(db: Db, userId: string): MyDayTags {
  const raw = db.select({ tags: users.dayTags }).from(users).where(eq(users.id, userId)).get()?.tags as
    | { own?: unknown; removed?: unknown }
    | null
    | undefined;
  const read = (v: unknown) =>
    Array.isArray(v) ? [...new Set(v.map((t) => (typeof t === "string" ? cleanDayTag(t) : null)).filter((t) => t !== null))] : [];
  return { own: read(raw?.own).slice(0, MAX_OWN_DAY_TAGS), removed: read(raw?.removed) };
}

function writeDayTags(db: Db, userId: string, tags: MyDayTags): void {
  // audit-exempt: tags for one person's own note, seen only through a day
  // share they opted its mood into, like the note itself.
  db.update(users).set({ dayTags: tags }).where(eq(users.id, userId)).run();
}

/**
 * Keep `added` as the user's own tags, as they save a note with them: each
 * that's a tag (cleanDayTag) and not a preset or theirs already, while they
 * have fewer than MAX_OWN_DAY_TAGS. Returns their own tags as kept.
 */
export function keepDayTags(db: Db, userId: string, added: readonly string[]): string[] {
  const mine = getDayTags(db, userId);
  const own = [...mine.own];
  for (const raw of added) {
    const tag = cleanDayTag(raw);
    if (!tag || own.length >= MAX_OWN_DAY_TAGS || dayTagsFor(own).some((t) => t.toLowerCase() === tag.toLowerCase())) continue;
    own.push(tag);
  }
  if (own.length === mine.own.length) return own;
  const removed = mine.removed.filter((r) => !own.some((t) => t.toLowerCase() === r.toLowerCase()));
  writeDayTags(db, userId, { own, removed });
  return own;
}

/**
 * Take `tag` off the user's own tags, and remember it so Claude doesn't
 * suggest it again. Returns their own tags as kept.
 */
export function removeDayTag(db: Db, userId: string, tag: string): string[] {
  const mine = getDayTags(db, userId);
  const gone = mine.own.find((t) => t.toLowerCase() === tag.trim().toLowerCase());
  if (!gone) return mine.own;
  const own = mine.own.filter((t) => t !== gone);
  writeDayTags(db, userId, { own, removed: [...mine.removed.filter((r) => r !== gone), gone].slice(-MAX_REMOVED) });
  return own;
}

/**
 * What `viewerId` may see of `personId`'s note for their own today, and of
 * how it went once they close it (dayWrapUps.ts): the words, the mood
 * (tags), both or neither, as `personId` chose when sharing their day with
 * them (an accepted membership limited to their items and a window, with
 * shareNote or shareMood). Whichever share allows more wins.
 */
export function sharedDayNote(
  db: Db,
  viewerId: string,
  personId: string,
  now = Date.now(),
): { note: string | null; mood: string[]; wrapUp: SeenWrapUp | null } {
  const shares = [projectMembers, spaceMembers].flatMap((m) =>
    db
      .select({ note: m.shareNote, mood: m.shareMood })
      .from(m)
      .where(
        and(
          eq(m.userId, viewerId),
          eq(m.onlyAssignedTo, personId),
          eq(m.status, "accepted"),
          isNotNull(m.onlyWithin),
          or(eq(m.shareNote, true), eq(m.shareMood, true)),
        ),
      )
      .all(),
  );
  // And a day shared without places of its own, once accepted.
  const own = db
    .select({ note: dayShares.shareNote, mood: dayShares.shareMood })
    .from(dayShares)
    .where(and(eq(dayShares.viewerId, viewerId), eq(dayShares.sharerId, personId), eq(dayShares.status, "accepted")))
    .get();
  if (own) shares.push(own);
  const words = shares.some((s) => s.note);
  const mood = shares.some((s) => s.mood);
  if (!words && !mood) return { note: null, mood: [], wrapUp: null };
  const zone = db.select({ tz: users.timeZone }).from(users).where(eq(users.id, personId)).get()?.tz;
  const day = dayOf(now, validZone(zone));
  const wrapUp = seenWrapUp(getWrapUp(db, personId, day), words, mood);
  const text = getDayNote(db, personId, day);
  if (!text) return { note: null, mood: [], wrapUp };
  const { tags, rest } = splitDayNote(text, getDayTags(db, personId).own);
  return { note: words && rest ? rest : null, mood: mood ? tags : [], wrapUp };
}
