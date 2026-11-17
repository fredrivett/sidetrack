"use client";

import { CalendarDays } from "lucide-react";
import { dueLabel, dueWord } from "@/lib/time";
import { useLabelDay } from "./use-day-start";

// An item's due day, or span from `from` to `due` ("This week"), as a small
// pill: red once it's overdue and still open, stronger on its last day. Until
// the browser knows the viewer's day (server render and hydration), it goes
// by the server's guess (useLabelDay). Without the browser's locale it shows
// only the labels that need none ("This weekend"), else the plain date.
export function DueBadge({
  due,
  from,
  done,
}: {
  due: string;
  from?: string | null;
  done: boolean;
}) {
  const { today, locale } = useLabelDay();
  const label =
    today && locale !== null
      ? dueLabel(due, today, from, locale)
      : ((today && dueWord(due, today, from)) ?? (from ? `${from} – ${due}` : due));
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
