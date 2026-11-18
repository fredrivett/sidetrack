// The Agenda greeting written from its brief by hand-picked rules: what shows
// when AI is off or the writer fails, and the first greeting the Agenda
// gets. It says one or two things, never the whole board, and never nags:
// no backlog totals, no streaks, nothing in red, no exclamation marks.
//
// Items are named by token, never by title, so the page can show each one
// as a chip that opens it: `{{item:<id>}}`. An action reads
// `{{action:<name>|<words>}}`, the words being what the reader taps.

import type { AgendaBrief, BriefItem } from "./agendaBrief";
import { addDays } from "../lib/time";

/** What an action token does when tapped. */
export type GreetingAction = "triage";

const item = (i: BriefItem) => `{{item:${i.id}}}`;
const action = (name: GreetingAction, words: string) => `{{action:${name}|${words}}}`;

const NUMBERS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const count = (n: number) => NUMBERS[n] ?? String(n);
const things = (n: number) => `${count(n)} ${n === 1 ? "thing" : "things"}`;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "a", "a and b", "a, b and c". */
function and(parts: string[]): string {
  return parts.length < 2 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/**
 * One of `options`, the same all through one part of one day, so a reload
 * doesn't reword it, but not the same every morning.
 */
function pick(brief: AgendaBrief, salt: string, options: string[]): string {
  let h = 0;
  for (const c of `${brief.today}:${brief.partOfDay}:${salt}`) h = (h * 31 + c.charCodeAt(0)) | 0;
  return options[Math.abs(h) % options.length];
}

/** "yesterday", "Friday", or null when the last read was today or long ago. */
function sinceWord(brief: AgendaBrief, sinceDay: string): string | null {
  if (sinceDay >= brief.today) return null;
  if (sinceDay === addDays(brief.today, -1)) return "yesterday";
  if (sinceDay < addDays(brief.today, -6)) return "last time";
  return weekdayOf(sinceDay);
}

const weekdayOf = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });

/** The busiest day from tomorrow to a week on, when it stands out. */
function heavyDay(brief: AgendaBrief): { day: string; open: number } | null {
  const week = brief.ahead.slice(0, 7);
  const busiest = week.reduce<{ day: string; open: number } | null>(
    (best, d) => (!best || d.open > best.open ? d : best),
    null,
  );
  if (!busiest || busiest.open < 4) return null;
  const others = week.filter((d) => d !== busiest);
  const usual = others.reduce((n, d) => n + d.open, 0) / Math.max(others.length, 1);
  return busiest.open >= 2 * usual ? busiest : null;
}

function dayName(day: string, today: string): string {
  const name = weekdayOf(day);
  if (day === addDays(today, 1)) return "Tomorrow";
  return day > addDays(today, 6) ? `Next ${name}` : name;
}

/**
 * The greeting for `brief`, with item and action tokens. `name` is the
 * viewer's first name, or null to greet without one.
 */
export function templateGreeting(brief: AgendaBrief, name: string | null): string {
  const to = name ? `, ${name}` : "";
  const hello =
    brief.partOfDay === "morning"
      ? `Good morning${to}.`
      : brief.partOfDay === "afternoon"
        ? `Good afternoon${to}.`
        : `Evening${to}.`;

  const open = brief.dueToday.filter((i) => i.completedAt === null);
  const doneToday = brief.dueToday.length - open.length;

  // Evening winds down: today's left, or nothing, and no looking ahead.
  if (brief.partOfDay === "evening") {
    if (open.length === 0) {
      return `${hello} ${pick(brief, "evening-clear", [
        "That's everything for today. Enjoy the evening.",
        "Nothing left for today. Enjoy the rest of the evening.",
      ])}`;
    }
    return `${hello} ${capital(things(open.length))} still open from today. ${pick(brief, "evening-open", [
      "They'll keep until tomorrow.",
      "Fine to leave them for tomorrow.",
    ])}`;
  }

  const sentences = [hello];

  // Warmth from the look-back, when there's a day to look back to.
  const finished = brief.lookBack.finishedCount;
  const when = brief.sinceDay ? sinceWord(brief, brief.sinceDay) : null;
  if (when && finished > 0) {
    const since = when === "last time" ? "Since last time" : `Since ${when}`;
    sentences.push(
      `${since} you've finished ${finished === 1 ? item(brief.lookBack.finished[0]) : count(finished)}${finished >= 3 ? " — nice" : ""}.`,
    );
  }

  const day = brief.weekday;
  if (brief.overdue.length > 0) {
    // What slipped comes first, gently.
    sentences.push(
      brief.overdue.length === 1
        ? `${item(brief.overdue[0])} is still waiting. No rush — want to ${action("triage", "give it a new day")}?`
        : `A few earlier things are still waiting. No rush — want to ${action("triage", "give them new days")}, or let some go?`,
    );
  } else if (open.length > 0) {
    if (brief.partOfDay === "afternoon") {
      sentences.push(
        open.length === 1
          ? `Just ${item(open[0])} left for today.`
          : `${capital(things(open.length))} left for today.`,
      );
    } else if (open.length === 1) {
      sentences.push(`A gentle ${day}: just ${item(open[0])} today.`);
    } else if (open.length <= 3) {
      sentences.push(`A gentle ${day}: ${and(open.map(item))} today.`);
    } else {
      sentences.push(
        `A fuller ${day}: ${things(open.length)} today. ${item(open[0])} is a good place to start.`,
      );
    }
  } else if (doneToday > 0) {
    sentences.push("That's everything for today.");
  } else {
    // Nothing due: look ahead, or offer something undated, or just be quiet.
    const heavy = heavyDay(brief);
    const nudge = brief.undated.slice(0, 2);
    const stale = brief.stale.slice(0, 2);
    if (heavy) {
      sentences.push(
        `Nothing due today. ${dayName(heavy.day, brief.today)} looks busy, so maybe move one thing earlier?`,
      );
    } else if (nudge.length > 0) {
      sentences.push(
        `Nothing due today. ${and(nudge.map(item))} might be worth a look, if you feel like picking something up.`,
      );
    } else if (stale.length > 0) {
      sentences.push(
        stale.length === 1
          ? `Nothing due today. ${item(stale[0])} has been sitting a while, if you feel like picking it up.`
          : `Nothing due today. Two things in No date have been sitting a while, if you feel like picking one up: ${and(stale.map(item))}.`,
      );
    } else {
      sentences.push(
        pick(brief, "quiet", [
          `Nothing due today. A quiet ${day}.`,
          `Nothing due today. Enjoy the quiet.`,
        ]),
      );
    }
  }

  return sentences.join(" ");
}
