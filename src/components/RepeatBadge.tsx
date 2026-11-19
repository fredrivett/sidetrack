"use client";

import { Repeat as RepeatIcon } from "lucide-react";
import { nextDue, type Repeat, repeatLabel, repeatOnName } from "@/lib/repeat";
import { addDays, dayOf, type Due } from "@/lib/time";
import { useToday } from "./use-day-start";

/**
 * When something next due `next` comes back, from `today`: "Tomorrow", else
 * its weekday and date ("Sat 5 Dec"), or a span's ("Sat 5 – Sun 6 Dec"), so
 * a rule on Mondays or weekends shows that it keeps to them.
 */
export function backLabel(next: Due, today: string): string {
  if (!next.dueFrom && next.dueDate === addDays(today, 1)) return "Tomorrow";
  const format = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year:
      next.dueDate.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric",
    timeZone: "UTC",
  });
  const date = (day: string) => new Date(`${day}T00:00:00Z`);
  return next.dueFrom
    ? format.formatRange(date(next.dueFrom), date(next.dueDate))
    : format.format(date(next.dueDate));
}

/**
 * When a finished repeating item comes back: its rule's gap after the day it
 * was done, in the viewer's day, or the first weekday or weekend it keeps to
 * from then (see nextDue). Null until the viewer's day is known, and once
 * that day has come (the server reopens it on the next load).
 */
export function useComesBack(
  repeat: Repeat | null,
  completedAt: number | null,
): string | null {
  const today = useToday();
  if (!repeat || completedAt === null || !today) return null;
  const next = nextDue(dayOf(completedAt), repeat);
  return (next.dueFrom ?? next.dueDate) > today ? backLabel(next, today) : null;
}

const EVERY_ONE = { day: "Daily", week: "Weekly", month: "Monthly" } as const;

/**
 * A rule in a few words beside the repeat icon, which already says "every":
 * "Weekly", "2 weeks • weekends", "3 days".
 */
function shortLabel({ every, unit, on }: Repeat): string {
  const gap = every === 1 ? EVERY_ONE[unit] : `${every} ${unit}s`;
  return on ? `${gap} • ${repeatOnName(on)}` : gap;
}

// A repeating item's rule as a small pill next to its due date, spelled out
// on hover and to screen readers. Once it's done, it says when it comes back
// instead.
export function RepeatBadge({
  repeat,
  completedAt,
}: {
  repeat: Repeat;
  completedAt: number | null;
}) {
  const back = useComesBack(repeat, completedAt);
  return (
    <span
      title={repeatLabel(repeat)}
      className="inline-flex items-center gap-1 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
    >
      <RepeatIcon className="size-3" />
      {back ? (
        `Next: ${back}`
      ) : (
        <>
          <span aria-hidden>{shortLabel(repeat)}</span>
          <span className="sr-only">{repeatLabel(repeat)}</span>
        </>
      )}
    </span>
  );
}
