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
function weekday(day: string): number {
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

/** "This weekend" from `today`: today on a Saturday or Sunday, else Saturday. */
export function thisWeekend(today: string): string {
  const w = weekday(today);
  return w === 0 || w === 6 ? today : addDays(today, 6 - w);
}

/** "Next week" from `today`: the coming Monday. */
export function nextWeek(today: string): string {
  return addDays(today, 7 - ((weekday(today) + 6) % 7));
}

/**
 * The quick due-date choices offered from `today` (the item sheet's buttons
 * and the row menu): Today, Tomorrow, This weekend and Next week, dropping
 * any that land on a day already offered (on a Saturday, This weekend is
 * Today; on a Sunday, Next week is Tomorrow).
 */
export function quickDueDays(today: string): Array<[label: string, day: string]> {
  const all: Array<[string, string]> = [
    ["Today", today],
    ["Tomorrow", addDays(today, 1)],
    ["This weekend", thisWeekend(today)],
    ["Next week", nextWeek(today)],
  ];
  return all.filter(([, day], i) => all.findIndex(([, d]) => d === day) === i);
}

/** Whether the runtime's locale writes the day before the month (1/12 = 1 Dec). */
function dayFirst(): boolean {
  const parts = new Intl.DateTimeFormat().formatToParts(new Date(2000, 0, 2));
  const at = (type: string) => parts.findIndex((p) => p.type === type);
  return at("day") < at("month");
}

/**
 * The due day typed text means from `today`, or null when it isn't a date:
 * "fri", "in 2 weeks", "27 nov", "end of month". The quick buttons' names
 * mean what the buttons set ("next week" is the coming Monday, not today + 7).
 * Weekdays and dates look ahead: on a Wednesday "mon" is the coming Monday,
 * on a Friday "fri" is next week's ("this fri" is today), and in December
 * "3 jan" is next year's. Numeric dates follow the runtime
 * locale, so "1/12" is 1 December in the UK and 12 January in the US.
 */
export function parseDueDay(text: string, today: string): string | null {
  const t = text.trim().toLowerCase();
  const named: Record<string, string> = {
    today,
    tomorrow: addDays(today, 1),
    weekend: thisWeekend(today),
    "this weekend": thisWeekend(today),
    "next week": nextWeek(today),
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
  return weekdayOnly && day === today && !/^this\b/.test(t) ? addDays(today, 7) : day;
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
 * Short label for a due day relative to `today`: "Today", "Tomorrow",
 * "Yesterday", a weekday within the coming week ("Sat"), else "21 Nov" (with
 * the year when it isn't this year's).
 */
export function dueLabel(due: string, today: string): string {
  if (due === today) return "Today";
  if (due === addDays(today, 1)) return "Tomorrow";
  if (due === addDays(today, -1)) return "Yesterday";
  const [y, m, d] = due.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (due > today && due < addDays(today, 7)) {
    return date.toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" });
  }
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: due.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric",
    timeZone: "UTC",
  });
}

/**
 * Whether an item belongs in the Today view on `today`: it's due on or before
 * today, and it's either still open or was finished today (shown crossed out,
 * like the lists). `timeZone` decides which day a completion fell on.
 */
export function isOnToday(
  item: { dueDate: string | null; completedAt: number | null },
  today: string,
  timeZone?: string,
): boolean {
  if (!item.dueDate || item.dueDate > today) return false;
  return item.completedAt === null || dayOf(item.completedAt, timeZone) === today;
}

/**
 * Whether an item belongs in the No date view on `today`: an item with no due
 * date that's open or was finished today (crossed out, as on Today). A
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
