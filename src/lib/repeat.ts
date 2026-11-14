import { addDays } from "./time";

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
