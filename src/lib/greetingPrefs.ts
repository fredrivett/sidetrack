// How someone likes their Agenda greeting: how long, and a note in their own
// words for Claude. Kept as one JSON value per person and read leniently, so
// the greeting can change shape without migrating anyone's settings: a value
// it doesn't know is dropped, a missing one is the default.
// Framework-agnostic: no DB access.

export const GREETING_LENGTHS = ["short", "medium", "long"] as const;
export type GreetingLength = (typeof GREETING_LENGTHS)[number];

/** The most a note may be, in characters. */
export const NOTE_MAX = 280;

export interface GreetingPrefs {
  length: GreetingLength;
  /** The reader's own words for Claude, such as "keep it short"; "" for none. */
  note: string;
  /** Whether Sidetrack may read the note to improve the greeting for everyone. */
  shareNote: boolean;
}

export const DEFAULT_GREETING_PREFS: GreetingPrefs = { length: "long", note: "", shareNote: true };

/** Per length: the most sentences Claude may write, and the most things it says. */
export const LENGTH_LIMITS: Record<GreetingLength, { sentences: number; moments: number }> = {
  short: { sentences: 1, moments: 1 },
  medium: { sentences: 2, moments: 2 },
  long: { sentences: 3, moments: 2 },
};

/** A note as kept: one line, trimmed, NOTE_MAX characters at most. */
export function cleanNote(note: string): string {
  return Array.from(note.replace(/\s+/g, " ").trim()).slice(0, NOTE_MAX).join("");
}

/** `raw` as settings, whatever it holds: anything unknown or missing is the default. */
export function parseGreetingPrefs(raw: unknown): GreetingPrefs {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    length: GREETING_LENGTHS.includes(r.length as GreetingLength)
      ? (r.length as GreetingLength)
      : DEFAULT_GREETING_PREFS.length,
    note: typeof r.note === "string" ? cleanNote(r.note) : DEFAULT_GREETING_PREFS.note,
    shareNote: typeof r.shareNote === "boolean" ? r.shareNote : DEFAULT_GREETING_PREFS.shareNote,
  };
}
