// Quick words for someone's note about their day ("How's today looking?"),
// tapped as chips instead of typed. They're kept in the note itself, ahead
// of anything typed, as "Tired, Stressed — rough night", so the greeting's
// writer reads them like any note and nothing else changes shape. As
// someone types, Jev says which of them fit what they wrote, for the page to
// suggest. Framework-agnostic: a plain fetch, no DB access.

import { NOTE_MAX } from "./greetingPrefs";
import { askJev, type NoulQuestion } from "./jev";

/** Each tag, as shown and kept, and what it means, for Jev. In the order they're shown and kept. */
export const DAY_TAGS = {
  Motivated: "keen, energetic, wants to get a lot done today",
  Focused: "wants to concentrate on one or two things, head down",
  Busy: "a full or packed day, lots on, short on time",
  "Taking it easy": "wants a light, slow or quiet day, not taking much on",
  Tired: "low on energy, slept badly, worn out",
  Stressed: "anxious, overwhelmed, under pressure",
  Unwell: "ill, sick, in pain, not feeling well",
} as const;

export type DayTag = keyof typeof DAY_TAGS;
const TAGS = Object.keys(DAY_TAGS) as DayTag[];
const SEPARATOR = " — ";

/** A note as its tags and the rest, what was typed. A note whose start isn't all tags is all typed. */
export function splitDayNote(note: string): { tags: DayTag[]; rest: string } {
  const at = note.indexOf(SEPARATOR);
  const head = at === -1 ? note : note.slice(0, at);
  const tags = head.split(",").map((word) => TAGS.find((t) => t.toLowerCase() === word.trim().toLowerCase()));
  if (!head.trim() || tags.some((t) => t === undefined)) return { tags: [], rest: note.trim() };
  return {
    tags: TAGS.filter((t) => tags.includes(t)),
    rest: at === -1 ? "" : note.slice(at + SEPARATOR.length).trim(),
  };
}

/** The note for `tags` and the typed `rest`, as splitDayNote reads it back. */
export function joinDayNote(tags: readonly DayTag[], rest: string): string {
  const head = TAGS.filter((t) => tags.includes(t)).join(", ");
  const typed = rest.trim();
  return head && typed ? `${head}${SEPARATOR}${typed}` : head || typed;
}

/**
 * `note` with `tag` taken off, or put on; null when putting it on would
 * take the note past NOTE_MAX, where the server would cut off what was typed.
 */
export function toggleDayTag(note: string, tag: DayTag): string | null {
  const { tags, rest } = splitDayNote(note);
  if (tags.includes(tag)) return joinDayNote(tags.filter((t) => t !== tag), rest);
  const next = joinDayNote([...tags, tag], rest);
  // In characters, as cleanNote counts them.
  return Array.from(next).length > NOTE_MAX ? null : next;
}

// How likely Jev must think a tag fits before it's suggested: it's only a
// highlight to tap or ignore, but one that fits loosely is noise.
const MIN_FIT = 0.7;
// Suggested at most, best first: more would light up the whole row.
const MAX_SUGGESTED = 2;

/**
 * The tags that fit what someone typed about their day, best first; [] when
 * none does or Jev can't be asked. One request, a yes/no per tag.
 */
export async function suggestDayTags(
  typed: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DayTag[]> {
  const questions = Object.fromEntries(
    TAGS.map((tag): [string, NoulQuestion] => [
      tag,
      {
        type: "noul",
        instructions: `Does the note say the writer's day is or feels "${tag}" (${DAY_TAGS[tag]})?`,
      },
    ]),
  );
  const answers = await askJev({ note_about_their_day: typed }, questions, apiKey, fetchImpl);
  if (!answers) return [];
  return TAGS.map((tag) => [tag, answers[tag]?.true ?? 0] as const)
    .filter(([, p]) => p >= MIN_FIT)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_SUGGESTED)
    .map(([tag]) => tag);
}
