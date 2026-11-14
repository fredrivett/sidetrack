"use client";

import { CalendarDays } from "lucide-react";
import { dueLabel } from "@/lib/time";
import { useToday } from "./use-day-start";

// An item's due day as a small pill: red once it's overdue and still open,
// stronger on the day itself. Until the viewer's day is known (server render),
// it shows the plain date.
export function DueBadge({
  due,
  done,
}: {
  due: string;
  done: boolean;
}) {
  const today = useToday();
  const label = today ? dueLabel(due, today) : due;
  const tone =
    today && !done && due < today
      ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400"
      : today && !done && due === today
        ? "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
        : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${tone}`}
    >
      <CalendarDays className="size-3" />
      {label}
    </span>
  );
}
