"use client";

import { Repeat as RepeatIcon } from "lucide-react";
import { nextDueDay, type Repeat, repeatLabel } from "@/lib/repeat";
import { dayOf, dueLabel } from "@/lib/time";
import { useToday } from "./use-day-start";

/**
 * When a finished repeating item comes back: its rule's gap after the day it
 * was done, in the viewer's day. Null until the viewer's day is known.
 */
export function useComesBack(
  repeat: Repeat | null,
  completedAt: number | null,
): string | null {
  const today = useToday();
  if (!repeat || completedAt === null || !today) return null;
  return dueLabel(nextDueDay(dayOf(completedAt), repeat), today);
}

// A repeating item's rule as a small pill next to its due date. Once it's
// done, it says when it comes back instead.
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
      {back ? `Back ${back}` : repeatLabel(repeat)}
    </span>
  );
}
