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

/**
 * Where each part sits in `title`: its first place not taken by an earlier
 * part, matched without case. Earlier parts win, so pass the rules' first.
 * A part no longer in the title (typing moved on) is left out.
 */
export function placeParts(title: string, parts: TitlePart[]): PlacedPart[] {
  const lower = title.toLowerCase();
  const placed: PlacedPart[] = [];
  for (const part of parts) {
    const text = part.text.toLowerCase();
    if (!text.trim()) continue;
    for (let from = 0; ; ) {
      const start = lower.indexOf(text, from);
      if (start < 0) break;
      const end = start + text.length;
      if (!placed.some((p) => start < p.end && end > p.start)) {
        placed.push({ ...part, start, end });
        break;
      }
      from = start + 1;
    }
  }
  return placed.sort((a, b) => a.start - b.start);
}

// What joins a part to the rest: taken out with it.
const JOIN = String.raw`(?:,|;|:|&|-|–|—|\band\b|\bthen\b)`;
// Words that bring in a date or a repeat, taken out with it.
const LEAD = /\b(?:by|on|due|starting|from|until|before)\s+$/i;
const GAP = "\u0000";

/**
 * The spans of `title` taken out with `parts`: each with the word that
 * brings in a date or repeat, as in "by Friday".
 */
export function removedSpans(title: string, parts: PlacedPart[]): Array<[number, number]> {
  return parts.map((p) => {
    const lead = p.field === "due" || p.field === "repeat" ? LEAD.exec(title.slice(0, p.start)) : null;
    return [lead ? lead.index : p.start, p.end];
  });
}

/**
 * `title` without `parts` (the ones to take out) and the words joining them
 * to the rest, starting with a capital when its start was taken out. The
 * title as it is when nothing would be left.
 */
export function trimTitle(title: string, parts: PlacedPart[]): string {
  const cuts = removedSpans(title, parts).sort((a, b) => a[0] - b[0]);
  if (cuts.length === 0) return title.trim();
  let out = "";
  let at = 0;
  for (const [s, e] of cuts) {
    if (s >= at) out += `${title.slice(at, s)} ${GAP} `;
    at = Math.max(at, e);
  }
  out += title.slice(at);
  const trimmed = out
    // "tomorrow and every monday" is one gap.
    .replace(new RegExp(String.raw`${GAP}(?:\s*${JOIN}?\s*${GAP})+`, "gi"), GAP)
    .replace(new RegExp(String.raw`\s*${JOIN}?\s*${GAP}\s*$`, "i"), "")
    .replace(new RegExp(String.raw`^\s*${GAP}\s*${JOIN}?\s*`, "i"), "")
    .replaceAll(GAP, " ")
    .replace(/\s+([,;.!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!trimmed) return title.trim();
  const fromStart = !title.slice(0, cuts[0][0]).trim();
  return fromStart ? trimmed[0].toUpperCase() + trimmed.slice(1) : trimmed;
}

/**
 * The words of `title` that aren't in `saved`, the title it adds as, so the
 * dialog can strike them where they're typed: what was taken out with the
 * parts, joining words and punctuation included. Words are matched in
 * order, ignoring case (a capital may have moved) and the punctuation next
 * to them.
 */
export function struckRanges(title: string, saved: string): Array<[number, number]> {
  const bare = (w: string) => w.toLowerCase().replace(/^[^\p{L}\p{N}@#]+|[^\p{L}\p{N}]+$/gu, "");
  const kept = saved.split(/\s+/).filter(Boolean).map(bare);
  const out: Array<[number, number]> = [];
  let k = 0;
  for (const m of title.matchAll(/\S+/g)) {
    if (k < kept.length && bare(m[0]) === kept[k]) {
      // "out:" keeps "out" but loses its colon.
      const trail = /[^\p{L}\p{N}]+$/u.exec(m[0]);
      const savedWord = saved.split(/\s+/).filter(Boolean)[k];
      if (trail && !savedWord.endsWith(trail[0])) out.push([m.index + trail.index, m.index + m[0].length]);
      k++;
    } else {
      out.push([m.index, m.index + m[0].length]);
    }
  }
  return out;
}
