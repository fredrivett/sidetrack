// The parts of a new item's title that set one of its fields: "tomorrow" its
// due date, "every monday" its repeat, "@sam" who does it, "#errands" a
// label, "Garden:" its list, and filler such as "Remind me to". New item highlights
// each, fills in its field, and adds the item without the parts that only
// said the field (`remove`), with the words that joined them. A part that's
// also what the task is ("Ask Sam to…", "tomorrow's breakfast") sets its
// field and stays. Shared by the browser (rules, placing, trimming) and the
// server (Claude finds the rest, titleParse.ts).

import type { Repeat } from "./repeat";
import type { Due } from "./time";

export type TitleField = "due" | "repeat" | "who" | "label" | "list" | "filler";

export type TitlePart = { text: string; remove: boolean } & (
  | { field: "due"; due: Due }
  | { field: "repeat"; repeat: Repeat }
  | { field: "who"; userId: string }
  | { field: "label"; label: string }
  | { field: "list"; projectId: string }
  | { field: "filler" }
);

/** A part where it sits in the title, from `start` up to `end`. */
export type PlacedPart = TitlePart & { start: number; end: number };

// Openers that only say it's a task, which every item already is.
const FILLER =
  /^(?:todo|to-do|to do|reminder|remind me to|remember to|don'?t forget to)\b[\s:,-]*/i;

/**
 * The parts plain rules find, with no AI: leading filler, an @handle of
 * someone who can do it, and a #word, which is the list's label of that name
 * or a new one.
 */
export function ruleParts(
  title: string,
  { people, labels }: { people: Array<{ userId: string; handle: string | null }>; labels: string[] },
): TitlePart[] {
  const out: TitlePart[] = [];
  const filler = FILLER.exec(title);
  if (filler) out.push({ field: "filler", text: filler[0].trimEnd(), remove: true });
  for (const m of title.matchAll(/(?<=^|\s)@([\w.-]+)/g)) {
    const handle = m[1].replace(/[.-]+$/, "").toLowerCase();
    const person = people.find((p) => p.handle?.toLowerCase() === handle);
    if (person) out.push({ field: "who", userId: person.userId, text: `@${m[1]}`, remove: true });
  }
  for (const m of title.matchAll(/(?<=^|\s)#([\p{L}\p{N}_-]+)/gu)) {
    const name = labels.find((l) => l.toLowerCase() === m[1].toLowerCase()) ?? m[1];
    out.push({ field: "label", label: name, text: `#${m[1]}`, remove: true });
  }
  return out;
}

// A letter or digit, which a part must not run into: "Mon" isn't in "lemons".
const WORD = /[\p{L}\p{N}]/u;

/**
 * Where `text` (lower case) next stands as whole words in `lower`, from
 * `from`: not inside a longer word, nor a possessive ("Friday's" isn't
 * "Friday"). -1 when it doesn't.
 */
export function findWhole(lower: string, text: string, from = 0): number {
  for (let start = lower.indexOf(text, from); start >= 0; start = lower.indexOf(text, start + 1)) {
    const end = start + text.length;
    const before = lower[start - 1] ?? "";
    const after = lower.slice(end, end + 2);
    const joinsBefore = WORD.test(text[0]) && WORD.test(before);
    const joinsAfter =
      WORD.test(text[text.length - 1]) && (WORD.test(after[0] ?? "") || /^['’]\p{L}/u.test(after));
    if (!joinsBefore && !joinsAfter) return start;
  }
  return -1;
}

/**
 * Where each part sits in `title`: its first place as whole words not taken
 * by an earlier part, matched without case. Earlier parts win, so pass the
 * rules' first. A part no longer in the title (typing moved on) is left out.
 */
export function placeParts(title: string, parts: TitlePart[]): PlacedPart[] {
  const lower = title.toLowerCase();
  const placed: PlacedPart[] = [];
  for (const part of parts) {
    const text = part.text.toLowerCase();
    if (!text.trim()) continue;
    for (let start = findWhole(lower, text); start >= 0; start = findWhole(lower, text, start + 1)) {
      const end = start + text.length;
      if (!placed.some((p) => start < p.end && end > p.start)) {
        placed.push({ ...part, start, end });
        break;
      }
    }
  }
  return placed.sort((a, b) => a.start - b.start);
}

// What joins a part to the rest: taken out with it.
const JOIN = String.raw`(?:,|;|:|&|-|–|—|\band\b|\bthen\b)`;
const JOIN_ONLY = new RegExp(String.raw`^\s*${JOIN}?\s*$`, "i");
const JOIN_START = new RegExp(String.raw`^\s*${JOIN}?\s*`, "i");
const JOIN_END = new RegExp(String.raw`\s*${JOIN}?\s*$`, "i");
// Words that bring in a date or a repeat, taken out with it.
const LEAD = /\b(?:by|on|due|starting|from|until|before)\s+$/i;

/**
 * `title` without `parts` (the ones to take out), the words that bring a
 * date or repeat in ("by Friday") and the words joining them to the rest:
 * `saved`, the title it adds as, starting with a capital when its start was
 * taken out, and `struck`, the spans of `title` taken out, for the dialog to
 * strike where they're typed. Both come from the same cut, so they agree.
 * The title as it is when nothing would be left.
 */
export function cutTitle(
  title: string,
  parts: PlacedPart[],
): { saved: string; struck: Array<[number, number]> } {
  const out = new Array<boolean>(title.length).fill(false);
  const cut = (s: number, e: number) => out.fill(true, s, e);
  for (const p of parts) {
    const lead = p.field === "due" || p.field === "repeat" ? LEAD.exec(title.slice(0, p.start)) : null;
    cut(lead ? lead.index : p.start, p.end);
  }
  const unchanged = { saved: title.trim(), struck: [] };
  if (!out.includes(true)) return unchanged;
  // The runs of title left between the cuts.
  const runs = () => {
    const found: Array<[number, number]> = [];
    for (let i = 0; i < title.length; ) {
      if (out[i]) {
        i++;
        continue;
      }
      let j = i;
      while (j < title.length && !out[j]) j++;
      found.push([i, j]);
      i = j;
    }
    return found;
  };
  // "tomorrow and every monday": what only joins two cuts goes with them.
  for (const [s, e] of runs()) {
    if (s > 0 && e < title.length && JOIN_ONLY.test(title.slice(s, e))) cut(s, e);
  }
  // As does a join between a cut and the start or end of what's left.
  const left = runs().filter(([s, e]) => title.slice(s, e).trim());
  if (left.length === 0) return unchanged;
  const [fs, fe] = left[0];
  // Both always match, if only the empty string.
  if (fs > 0) cut(fs, fs + (JOIN_START.exec(title.slice(fs, fe))?.[0].length ?? 0));
  const [ls, le] = left[left.length - 1];
  if (le < title.length) {
    cut(ls + (JOIN_END.exec(title.slice(ls, le))?.index ?? le - ls), le);
  }

  let saved = "";
  for (let i = 0; i < title.length; i++) {
    if (!out[i]) saved += title[i];
    else if (i === 0 || !out[i - 1]) saved += " ";
  }
  saved = saved.replace(/\s+([,;.!?])/g, "$1").replace(/\s{2,}/g, " ").trim();
  if (!saved) return unchanged;
  const firstWord = title.search(/\S/);
  if (out[firstWord]) saved = saved[0].toUpperCase() + saved.slice(1);
  const spans: Array<[number, number]> = [];
  for (let i = 0; i < title.length; ) {
    if (!out[i] || /\s/.test(title[i])) {
      i++;
      continue;
    }
    let j = i;
    while (j < title.length && out[j]) j++;
    let k = j;
    while (k > i && /\s/.test(title[k - 1])) k--;
    spans.push([i, k]);
    i = j;
  }
  return { saved, struck: spans };
}
