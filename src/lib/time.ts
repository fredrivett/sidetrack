import * as chrono from "chrono-node/en";

export function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const min = 60_000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (diff < min) return "just now";
  if (diff < hr) return `${Math.floor(diff / min)}m ago`;
  if (diff < day) return `${Math.floor(diff / hr)}h ago`;
  return `${Math.floor(diff / day)}d ago`;
}

/** Verbose relative time for agent/MCP output: "just now", "5 minutes ago", "7 months ago". */
export function formatRelativeLong(ts: number): string {
  const diff = Date.now() - ts;
  const min = 60_000;
  const hr = 60 * min;
  const day = 24 * hr;
  const week = 7 * day;
  const month = 30 * day;
  const year = 365 * day;
  const ago = (n: number, unit: string) =>
    `${n} ${unit}${n === 1 ? "" : "s"} ago`;
  if (diff < min) return "just now";
  if (diff < hr) return ago(Math.floor(diff / min), "minute");
  if (diff < day) return ago(Math.floor(diff / hr), "hour");
  if (diff < week) return ago(Math.floor(diff / day), "day");
  if (diff < month) return ago(Math.floor(diff / week), "week");
  if (diff < year) return ago(Math.floor(diff / month), "month");
  return ago(Math.floor(diff / year), "year");
}

/**
 * Hour (local time) at which "today" turns over. Items ticked off at 1am
 * still count as part of the evening before, so 4am rather than midnight.
 */
export const DAY_START_HOUR = 4;

/**
 * Start of the "today" that `now` falls in, in the runtime's local timezone:
 * the most recent DAY_START_HOUR at or before `now`. Each device uses its own
 * current timezone, so a traveller's day follows them.
 */
export function startOfDay(now: number): number {
  const d = new Date(now);
  const start = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    DAY_START_HOUR,
  );
  if (start.getTime() > now) start.setDate(start.getDate() - 1);
  return start.getTime();
}

/**
 * Start of the week `now` falls in, like startOfDay: DAY_START_HOUR on its
 * Monday, local time. Weeks run Monday to Sunday.
 */
export function startOfWeek(now: number): number {
  const d = new Date(startOfDay(now));
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

/** The next turnover after `now`: when startOfDay(now) next changes. */
export function nextDayStart(now: number): number {
  const d = new Date(startOfDay(now));
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

/**
 * Day bucket label: "Today", "Yesterday", else "16 May 2026". Days turn over
 * at DAY_START_HOUR like the rest of the app, so something done at 1am is
 * labelled with the evening before.
 */
export function dayLabel(ts: number): string {
  const day = startOfDay(ts);
  const dayMs = 24 * 60 * 60 * 1000;
  // Rounded, since a day with a DST change is 23 or 25 hours long.
  const delta = Math.round((startOfDay(Date.now()) - day) / dayMs);
  if (delta === 0) return "Today";
  if (delta === 1) return "Yesterday";
  return new Date(day).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Calendar days are "YYYY-MM-DD" strings (due dates, "today"). They compare
// correctly as strings, and date maths on them runs in UTC so no timezone or
// DST shift can move a day.
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar day written "YYYY-MM-DD" (not 2026-02-30). */
export function isDay(s: string): boolean {
  const m = DAY_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toISOString().slice(0, 10) === s;
}

/** The day `n` days after `day` (before, for negative `n`). */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// Building a formatter costs far more than using one, and list_today asks
// for every finished item's day, so keep one per named zone. The runtime's
// own zone isn't cached: the device can move to another one.
const dayFormats = new Map<string, Intl.DateTimeFormat>();
function dayFormat(timeZone?: string): Intl.DateTimeFormat {
  let f = timeZone ? dayFormats.get(timeZone) : undefined;
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    });
    if (timeZone) dayFormats.set(timeZone, f);
  }
  return f;
}

/**
 * The day `ts` falls in, with the same DAY_START_HOUR turnover as
 * startOfDay: 1am on the 15th is still the 14th. `timeZone` is an IANA zone;
 * leave it out for the runtime's own (the browser's, on the web).
 */
export function dayOf(ts: number, timeZone?: string): string {
  const parts = dayFormat(timeZone).formatToParts(new Date(ts));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const day = `${part("year")}-${part("month")}-${part("day")}`;
  return Number(part("hour")) < DAY_START_HOUR ? addDays(day, -1) : day;
}

/** How far `timeZone`'s wall clock is ahead of UTC at `ts`, in ms. */
function zoneOffset(ts: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(ts));
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  );
  return wall - (ts - (ts % 1000));
}

/** DAY_START_HOUR on calendar day `day` in `timeZone`. */
function turnoverIn(day: string, timeZone: string): number {
  const wall = Date.parse(`${day}T${String(DAY_START_HOUR).padStart(2, "0")}:00:00Z`);
  // The offset at the first guess can be the other side of a DST change;
  // the offset at the guess itself is the one at the turnover.
  const guess = wall - zoneOffset(wall, timeZone);
  return wall - zoneOffset(guess, timeZone);
}

/**
 * startOfDay in a named IANA zone rather than the runtime's own: DAY_START_HOUR
 * on the day `now` falls in there. The server uses it to guess the viewer's day.
 */
export function startOfDayIn(timeZone: string, now = Date.now()): number {
  return turnoverIn(dayOf(now, timeZone), timeZone);
}

/** startOfWeek in a named IANA zone, like startOfDayIn: 4am on its Monday. */
export function startOfWeekIn(timeZone: string, now = Date.now()): number {
  return turnoverIn(mondayOf(dayOf(now, timeZone)), timeZone);
}

/**
 * When an item is due: on `dueDate`, or, with `dueFrom`, any day of the span
 * from `dueFrom` to `dueDate` ("this week"). Overdue once `dueDate` passes.
 */
export type Due = { dueFrom: string | null; dueDate: string };

const onDay = (day: string): Due => ({ dueFrom: null, dueDate: day });

/** Monday of the week `day` is in; weeks run Monday to Sunday. */
function mondayOf(day: string): string {
  return addDays(day, -((weekday(day) + 6) % 7));
}

/**
 * A time no later than the start of the week `now` falls in (4am Monday,
 * see startOfWeek) in any timezone: midnight UTC on the Sunday before the
 * Monday of that week in `timeZone`. Even at UTC+14, 4am Monday is after it.
 * Without a zone, it takes UTC−12's week, the last to start.
 */
export function weekStartBound(timeZone?: string, now = Date.now()): number {
  const monday = mondayOf(dayOf(now, timeZone ?? "Etc/GMT+12"));
  return Date.parse(`${addDays(monday, -1)}T00:00:00Z`);
}

/**
 * The week, or its weekend, `weeks` weeks on from the one `today` is in:
 * 0 for this week, 1 for next week, -1 for last week.
 */
export function weekSpan(today: string, weeks: number, part: "week" | "weekend"): Due {
  const monday = addDays(mondayOf(today), 7 * weeks);
  return { dueFrom: addDays(monday, part === "week" ? 0 : 5), dueDate: addDays(monday, 6) };
}

/**
 * The quick due dates offered from `today` (the item dialog's buttons and the
 * row menu): Today, Tomorrow, This week, This weekend, Next week and Next
 * weekend. On a Sunday, the last day of both, This week and This weekend
 * would only mean today, so they drop out.
 */
export function quickDues(today: string): Array<[label: string, due: Due]> {
  const all: Array<[string, Due]> = [
    ["Today", onDay(today)],
    ["Tomorrow", onDay(addDays(today, 1))],
    ["This week", weekSpan(today, 0, "week")],
    ["This weekend", weekSpan(today, 0, "weekend")],
    ["Next week", weekSpan(today, 1, "week")],
    ["Next weekend", weekSpan(today, 1, "weekend")],
  ];
  // A span that ends today has only today left.
  return all.filter(([, due]) => !due.dueFrom || due.dueDate !== today);
}

type MaybeDue = { dueDate: string | null; dueFrom?: string | null } | null;

/** Whether two dues are the same day or the same span. */
export function sameDue(a: MaybeDue, b: MaybeDue): boolean {
  return (a?.dueDate ?? null) === (b?.dueDate ?? null) && (a?.dueFrom ?? null) === (b?.dueFrom ?? null);
}

/** Whether the runtime's locale writes the day before the month (1/12 = 1 Dec). */
function dayFirst(): boolean {
  const parts = new Intl.DateTimeFormat().formatToParts(new Date(2000, 0, 2));
  const at = (type: string) => parts.findIndex((p) => p.type === type);
  return at("day") < at("month");
}

/**
 * The due date typed text means from `today`, or null when it isn't a date:
 * "fri", "in 2 weeks", "27 nov", "end of month". The quick buttons' names
 * mean what the buttons set ("next week" is next Monday to Sunday, not
 * today + 7). Weekdays and dates look ahead: on a Wednesday "mon" is the
 * coming Monday, on a Friday "fri" is next week's ("this fri" is today), and
 * in December "3 jan" is next year's. Numeric dates follow the runtime
 * locale, so "1/12" is 1 December in the UK and 12 January in the US.
 */
export function parseDue(text: string, today: string): Due | null {
  const t = text.trim().toLowerCase();
  // Every quick button's name, including the two a Sunday drops: "this
  // week" then is still Monday to today.
  const named: Record<string, Due> = {
    today: onDay(today),
    tomorrow: onDay(addDays(today, 1)),
    week: weekSpan(today, 0, "week"),
    "this week": weekSpan(today, 0, "week"),
    weekend: weekSpan(today, 0, "weekend"),
    "this weekend": weekSpan(today, 0, "weekend"),
    "next week": weekSpan(today, 1, "week"),
    "next weekend": weekSpan(today, 1, "weekend"),
  };
  if (Object.hasOwn(named, t)) return named[t];
  // chrono's day-first parser reads "nov 27" as November 2027, so only
  // numeric dates go to it.
  const parser = dayFirst() && /\d\s*[/.-]\s*\d/.test(t) ? chrono.GB : chrono.casual;
  const [y, m, d] = today.split("-").map(Number);
  // Noon on `today`, so "tomorrow" counts from the app's day (which turns
  // over at 4am), not the clock's.
  const [found] = t ? parser.parse(t, new Date(y, m - 1, d, 12), { forwardDate: true }) : [];
  if (!found) return null;
  const day = localDay(found.start.date());
  // chrono reads today's weekday as today ("fri" on a Friday), but someone
  // typing it means next week's, unless they say "this fri".
  const weekdayOnly = found.start.isCertain("weekday") && !found.start.isCertain("day");
  return onDay(weekdayOnly && day === today && !/^this\b/.test(t) ? addDays(today, 7) : day);
}

/** The local calendar day of `date`, as "YYYY-MM-DD". */
export function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A "YYYY-MM-DD" day as local midnight, the inverse of localDay. */
export function localDate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * The days of a span in `locale` (the runtime's own when left out): "16–22
 * Nov", or "30 Nov – 6 Dec" (with the year when it isn't this year's). `long`
 * spells it out for the date picker: "Monday 16 – Sunday 22 November".
 */
export function spanDates(
  from: string,
  to: string,
  today: string,
  long = false,
  locale?: string,
): string {
  const thisYear = from.slice(0, 4) === today.slice(0, 4) && to.slice(0, 4) === today.slice(0, 4);
  return new Intl.DateTimeFormat(locale, {
    weekday: long ? "long" : undefined,
    day: "numeric",
    month: long ? "long" : "short",
    year: thisYear ? undefined : "numeric",
    timeZone: "UTC",
  }).formatRange(new Date(`${from}T00:00:00Z`), new Date(`${to}T00:00:00Z`));
}

/**
 * Cookie holding the browser's locale, so the server writes due labels the
 * way the browser will ("21 Nov", not "Nov 21") and they don't change as the
 * page loads.
 */
export const LOCALE_COOKIE = "sidetrack-locale";

/** The locale in LOCALE_COOKIE, or null when it's missing or not one. */
export function cookieLocale(value: string | undefined): string | null {
  try {
    return value ? (Intl.DateTimeFormat.supportedLocalesOf(value)[0] ?? null) : null;
  } catch {
    return null;
  }
}

/**
 * dueLabel's labels that read the same in every locale ("Today", "This
 * weekend"), or null when it would show a date. The server can render these
 * without knowing the browser's locale.
 */
export function dueWord(due: string, today: string, from?: string | null): string | null {
  if (from) {
    for (const [weeks, word] of [[0, "This"], [1, "Next"], [-1, "Last"]] as const) {
      for (const part of ["week", "weekend"] as const) {
        if (sameDue({ dueFrom: from, dueDate: due }, weekSpan(today, weeks, part))) {
          return `${word} ${part}`;
        }
      }
    }
    return null;
  }
  if (due === today) return "Today";
  if (due === addDays(today, 1)) return "Tomorrow";
  if (due === addDays(today, -1)) return "Yesterday";
  return null;
}

/**
 * Short label for when something's due, relative to `today`. A day is
 * "Today", "Tomorrow", "Yesterday", a weekday within the coming week ("Sat"),
 * else "21 Nov" (with the year when it isn't this year's). A span `from` that
 * day is "This week", "Next weekend", "Last week" and so on, else its dates.
 * Dates are in `locale`, the runtime's own when left out.
 */
export function dueLabel(
  due: string,
  today: string,
  from?: string | null,
  locale?: string,
): string {
  const word = dueWord(due, today, from);
  if (word) return word;
  if (from) return spanDates(from, due, today, false, locale);
  const [y, m, d] = due.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (due > today && due < addDays(today, 7)) {
    return date.toLocaleDateString(locale, { weekday: "short", timeZone: "UTC" });
  }
  return date.toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: due.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric",
    timeZone: "UTC",
  });
}

/**
 * Whether an item is due now on `today` (list_today): it's due on or before
 * today, or in a span that has started ("this week" from Monday), and it's
 * either still open or was finished today (shown crossed out, like the
 * lists). `timeZone` decides which day a completion fell on.
 */
export function isOnToday(
  item: { dueDate: string | null; dueFrom?: string | null; completedAt: number | null },
  today: string,
  timeZone?: string,
): boolean {
  if (!item.dueDate || (item.dueFrom ?? item.dueDate) > today) return false;
  return item.completedAt === null || dayOf(item.completedAt, timeZone) === today;
}

/**
 * Whether an item belongs in the Agenda's No date section on `today`: an item
 * with no due date that's open or was finished today (crossed out). A
 * sub-item of a dated parent stays out, since it's planned with its parent.
 */
export function isOnNoDate(
  item: {
    dueDate: string | null;
    completedAt: number | null;
  },
  parent: { dueDate: string | null } | undefined,
  today: string,
  timeZone?: string,
): boolean {
  if (item.dueDate || parent?.dueDate) return false;
  return item.completedAt === null || dayOf(item.completedAt, timeZone) === today;
}

/** The Agenda view's sections, in the order it shows them. */
export const AGENDA_SECTIONS = [
  "Overdue",
  "Today",
  "This week",
  "Next week",
  "Later",
  "No date",
] as const;
export type AgendaSection = (typeof AGENDA_SECTIONS)[number];

/**
 * Which section of the Agenda view an item shows in on `today`, or null when
 * it's off it. Every open item is on it, and so is one finished today, crossed
 * out in place. A dated item goes under Overdue once its last day has passed;
 * one due today alone under Today; otherwise by the week it starts in, so a
 * span under way ("this week") is under This week to its last day. An
 * undated item goes under No date, except a sub-item of a dated parent, which
 * is planned with its parent (see isOnNoDate).
 */
export function agendaSection(
  item: { dueDate: string | null; dueFrom?: string | null; completedAt: number | null },
  parent: { dueDate: string | null } | undefined,
  today: string,
  timeZone?: string,
): AgendaSection | null {
  if (!item.dueDate) return isOnNoDate(item, parent, today, timeZone) ? "No date" : null;
  if (item.completedAt !== null && dayOf(item.completedAt, timeZone) !== today) return null;
  if (item.dueDate < today) return "Overdue";
  if (!item.dueFrom && item.dueDate === today) return "Today";
  const start = item.dueFrom ?? item.dueDate;
  const sunday = weekSpan(today, 0, "week").dueDate;
  if (start <= sunday) return "This week";
  if (start <= addDays(sunday, 7)) return "Next week";
  return "Later";
}
