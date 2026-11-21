import { addDays, type Due, weekday, weekSpan } from "./time";

// A repeat rule: "every 3 days", "every 2 weeks", "every month on
// Saturdays". The next due day counts from the day the item was last done,
// not from a fixed calendar, so watering the plants late moves the next
// watering too. When it's due this time (a date, "this weekend") is only
// this time; a rule that keeps to certain days says so with `on`, and a
// monthly one that keeps to a day of the month ("on the 1st") with `day`.
export const REPEAT_UNITS = ["day", "week", "month"] as const;
export type RepeatUnit = (typeof REPEAT_UNITS)[number];

/** The days a weekly or monthly rule keeps to: a weekday, or weekends. */
export const REPEAT_ONS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun", "weekend"] as const;
export type RepeatOn = (typeof REPEAT_ONS)[number];
const ON_NAMES: Record<RepeatOn, string> = {
  mon: "Mondays",
  tue: "Tuesdays",
  wed: "Wednesdays",
  thu: "Thursdays",
  fri: "Fridays",
  sat: "Saturdays",
  sun: "Sundays",
  weekend: "weekends",
};

export interface Repeat {
  every: number;
  unit: RepeatUnit;
  /** Only for week and month rules; absent or null for any day. */
  on?: RepeatOn | null;
  /**
   * Only for month rules, and not with `on`: the day of the month it keeps
   * to (1 to 31), whenever it's done; absent or null to count from that day.
   */
  day?: number | null;
}

/** Longest gap a rule may have, in its own unit ("every 365 days"). */
export const MAX_REPEAT_EVERY = 365;

/** `day` of the month `month` months after January `year`, or its last day. */
function dayInMonth(year: number, month: number, day: number): string {
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, last))).toISOString().slice(0, 10);
}

/**
 * The day an item done on `doneDay` is next due. A month later keeps the day
 * of the month, or the month's last day when it's shorter: done 31 January,
 * next due 28 February. A rule on a day of the month comes back on the first
 * of that day after it was done, then `every` - 1 months on: "every month on
 * the 1st" done on 21 November is due 1 December, and done on 1 December, 1
 * January. A month without that day uses its last.
 */
export function nextDueDay(doneDay: string, { every, unit, day }: Repeat): string {
  if (unit === "day") return addDays(doneDay, every);
  if (unit === "week") return addDays(doneDay, every * 7);
  const [y, m, d] = doneDay.split("-").map(Number);
  if (!day) return dayInMonth(y, m - 1 + every, d);
  const after = dayInMonth(y, m - 1, day) > doneDay ? 0 : 1;
  return dayInMonth(y, m - 1 + after + every - 1, day);
}

/**
 * When an item done on `doneDay` is next due: nextDueDay, or, for a rule
 * `on` certain days, the first of them from that day on (the weekend it
 * falls in, from Saturday, when that's a Sunday). "Every 2 weeks on
 * weekends" done late on a Wednesday is due the weekend after the Wednesday
 * two weeks on; done on a Sunday, the weekend two weeks on.
 */
export function nextDue(doneDay: string, rule: Repeat): Due {
  const day = nextDueDay(doneDay, rule);
  if (!rule.on) return { dueFrom: null, dueDate: day };
  if (rule.on === "weekend") return weekSpan(day, 0, "weekend");
  const target = (REPEAT_ONS.indexOf(rule.on) + 1) % 7; // 0 = Sunday
  return { dueFrom: null, dueDate: addDays(day, (target - weekday(day) + 7) % 7) };
}

/** "Every day", "Every 3 days", "Every 2 weeks on weekends", "Every month on the 1st". */
export function repeatLabel({ every, unit, on, day }: Repeat): string {
  const base = every === 1 ? `Every ${unit}` : `Every ${every} ${unit}s`;
  if (day) return `${base} on the ${ordinal(day)}`;
  return on ? `${base} on ${ON_NAMES[on]}` : base;
}

/** "1st", "2nd", "3rd", "11th", "22nd", "31st". */
export function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

/** The name of the days a rule keeps to: "Mondays", "weekends". */
export function repeatOnName(on: RepeatOn): string {
  return ON_NAMES[on];
}

/** An item's rule, or null when it doesn't repeat. */
export function repeatOf(item: {
  repeatEvery: number | null;
  repeatUnit: RepeatUnit | null;
  repeatOn?: RepeatOn | null;
  repeatDay?: number | null;
}): Repeat | null {
  if (!item.repeatEvery || !item.repeatUnit) return null;
  const rule: Repeat = { every: item.repeatEvery, unit: item.repeatUnit };
  if (item.repeatOn) rule.on = item.repeatOn;
  if (item.repeatDay) rule.day = item.repeatDay;
  return rule;
}
