// Live eval of Claude reading a new item's title (titleParse.ts): real
// requests, so it needs ANTHROPIC_API_KEY and costs a little. Not part of
// `pnpm test`; run it with `pnpm eval` after changing the prompt. Each case
// is what a person would expect New item to do with what they typed.

import { describe, expect, it } from "vitest";
import { askTitleParts } from "./titleParse";
import { cutTitle, placeParts, ruleParts, type TitlePart } from "./titleParts";

// A Wednesday, so "wednesday" alone means next week's.
const TODAY = "2026-11-18";
const ctx = { today: TODAY, lists: [], labels: [], people: [] };
const key = process.env.ANTHROPIC_API_KEY ?? "";
// The title it adds as, with the rules' parts too, as New item adds it.
const saveAs = (title: string, parts: TitlePart[]) => {
  const all = [...ruleParts(title, { people: [], labels: [] }), ...parts];
  return cutTitle(title, placeParts(title, all).filter((p) => p.remove)).saved;
};

type Case = [
  title: string,
  /** The day it's due, "from/to" for a span, or null for no date. */
  due: string | null,
  /** The title it adds as. */
  saved: string,
];

const CASES: Case[] = [
  // Said when to do it: due then, and the words come out.
  ["add wash clothes to tuesday", "2026-11-24", "Wash clothes"],
  ["wash clothes tuesday", "2026-11-24", "wash clothes"],
  ["Call mum tomorrow", "2026-11-19", "Call mum"],
  ["Pay rent by Friday", "2026-11-20", "Pay rent"],
  ["Tuesday: dentist", "2026-11-24", "Dentist"],
  ["Water plants wednesday", "2026-11-25", "Water plants"],
  ["Pack for the trip this weekend", "2026-11-21/2026-11-22", "Pack for the trip"],
  ["Do taxes next week", "2026-11-23/2026-11-29", "Do taxes"],
  // Said when what it's for happens: due the day before, and the words stay.
  ["buy breakfast for tomorrow", TODAY, "buy breakfast for tomorrow"],
  ["Buy food for tomorrow's breakfast", TODAY, "Buy food for tomorrow's breakfast"],
  ["Get wine for Saturday's party", "2026-11-20", "Get wine for Saturday's party"],
  ["Iron shirt for Monday's interview", "2026-11-22", "Iron shirt for Monday's interview"],
  // No date at all.
  ["Buy milk", null, "Buy milk"],
  ["Weekend shopping", null, "Weekend shopping"],
  ["Daily standup notes", null, "Daily standup notes"],
];

describe.skipIf(!key)("titleParse eval", () => {
  it.concurrent.each(CASES)("%s", async (title, due, saved) => {
    const parts = await askTitleParts(title, ctx, key, fetch);
    const dues = parts.flatMap((p) => (p.field === "due" ? [p.due] : []));
    const got = dues[0] ? [dues[0].dueFrom, dues[0].dueDate].filter(Boolean).join("/") : null;
    expect(got).toBe(due);
    expect(saveAs(title, parts)).toBe(saved);
  }, 20_000);

  // "to Thursday" here is what the task does, not when: it must stay.
  it.concurrent.each([
    "Move dentist to Thursday",
    "Push the call with Sam to Friday",
    "Postpone gym to Monday",
    "Reschedule haircut to next week",
  ])(
    "keeps a date that's what the task is about: %s",
    async (title) => {
      const parts = await askTitleParts(title, ctx, key, fetch);
      expect(saveAs(title, parts)).toBe(title);
    },
    20_000,
  );
});
