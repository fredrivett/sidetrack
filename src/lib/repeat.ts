import { addDays, type Due, weekday, weekSpan } from "./time";

// A repeat rule: "every 3 days", "every 2 weeks", "every month on
// Saturdays". The next due day counts from the day the item was last done,
// not from a fixed calendar, so watering the plants late moves the next
// watering too. When it's due this time (a date, "this weekend") is only
// this time; a rule that keeps to certain days says so with `on`.
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
}

/** Longest gap a rule may have, in its own unit ("every 365 days"). */
export const MAX_REPEAT_EVERY = 365;

/**
 * The day an item done on `doneDay` is next due. A month later keeps the day
 * of the month, or the month's last day when it's shorter: done 31 January,
 * next due 28 February.
 */
export function nextDueDay(doneDay: string, { every, unit }: Repeat): string {
  if (unit === "day") return addDays(doneDay, every);
  if (unit === "week") return addDays(doneDay, every * 7);
  const [y, m, d] = doneDay.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1 + every + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + every, Math.min(d, last)))
    .toISOString()
    .slice(0, 10);
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

/** "Every day", "Every 3 days", "Every 2 weeks on weekends". */
export function repeatLabel({ every, unit, on }: Repeat): string {
  const base = every === 1 ? `Every ${unit}` : `Every ${every} ${unit}s`;
  return on ? `${base} on ${ON_NAMES[on]}` : base;
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
}): Repeat | null {
  if (!item.repeatEvery || !item.repeatUnit) return null;
  const rule: Repeat = { every: item.repeatEvery, unit: item.repeatUnit };
  if (item.repeatOn) rule.on = item.repeatOn;
  return rule;
}
