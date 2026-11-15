import { addDays, type Due, sameDue, weekSpan } from "./time";

// A repeat rule: "every 3 days", "every 2 weeks", "every month". The next due
// day counts from the day the item was last done, not from a fixed calendar,
// so watering the plants late moves the next watering too.
export const REPEAT_UNITS = ["day", "week", "month"] as const;
export type RepeatUnit = (typeof REPEAT_UNITS)[number];
export interface Repeat {
  every: number;
  unit: RepeatUnit;
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
 * When an item done on `doneDay`, and due `due`, is next due. A day is due
 * again on nextDueDay. A week or weekend ("this week") comes back as the week
 * or weekend that day falls in, so a weekly "this week" done on Wednesday is
 * next week, from Monday; any other span keeps its length from that day. It
 * comes back on the span's first day, never before the day after it was
 * done: "every day" for "this week" leaves the rest of this week.
 */
export function nextDue(
  doneDay: string,
  rule: Repeat,
  due: { dueDate: string | null; dueFrom: string | null } | null,
): Due {
  const day = nextDueDay(doneDay, rule);
  const { dueFrom, dueDate } = due ?? {};
  if (!dueFrom || !dueDate) return { dueFrom: null, dueDate: day };
  const part = (["week", "weekend"] as const).find((p) =>
    sameDue({ dueFrom, dueDate }, weekSpan(dueDate, 0, p)),
  );
  const length = (Date.parse(dueDate) - Date.parse(dueFrom)) / 86_400_000;
  const span = part ? weekSpan(day, 0, part) : { dueFrom: day, dueDate: addDays(day, length) };
  const dayAfter = addDays(doneDay, 1);
  const from = span.dueFrom && span.dueFrom > dayAfter ? span.dueFrom : dayAfter;
  return { dueFrom: from === span.dueDate ? null : from, dueDate: span.dueDate };
}

/** "Every day", "Every 3 days", "Every 2 weeks", "Every month". */
export function repeatLabel({ every, unit }: Repeat): string {
  return every === 1 ? `Every ${unit}` : `Every ${every} ${unit}s`;
}

/** An item's rule, or null when it doesn't repeat. */
export function repeatOf(item: {
  repeatEvery: number | null;
  repeatUnit: RepeatUnit | null;
}): Repeat | null {
  return item.repeatEvery && item.repeatUnit
    ? { every: item.repeatEvery, unit: item.repeatUnit }
    : null;
}
