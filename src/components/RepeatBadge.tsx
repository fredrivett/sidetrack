"use client";

import { Repeat as RepeatIcon } from "lucide-react";
import { nextDue, type Repeat, repeatLabel } from "@/lib/repeat";
import { dayOf, dueLabel } from "@/lib/time";
import { useToday } from "./use-day-start";

type ItemDue = { dueDate: string | null; dueFrom: string | null };

/**
 * When a finished repeating item comes back: its rule's gap after the day it
 * was done, in the viewer's day, or the first day of the week or weekend
 * it's next due in (see nextDue). Null until the viewer's day is known, and
 * once that day has come (the server reopens it on the next load).
 */
export function useComesBack(
  repeat: Repeat | null,
  completedAt: number | null,
  due: ItemDue | null = null,
): string | null {
  const today = useToday();
  if (!repeat || completedAt === null || !today) return null;
  const next = nextDue(dayOf(completedAt), repeat, due);
  const back = next.dueFrom ?? next.dueDate;
  return back > today ? dueLabel(back, today) : null;
}

// A repeating item's rule as a small pill next to its due date. Once it's
// done, it says when it comes back instead.
export function RepeatBadge({
  repeat,
  completedAt,
  due,
}: {
  repeat: Repeat;
  completedAt: number | null;
  /** When it was due, for a week or weekend that comes back as one. */
  due: ItemDue;
}) {
  const back = useComesBack(repeat, completedAt, due);
  return (
    <span
      title={repeatLabel(repeat)}
      className="inline-flex items-center gap-1 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
    >
      <RepeatIcon className="size-3" />
      {back ? `Back ${back}` : repeatLabel(repeat)}
    </span>
  );
}
