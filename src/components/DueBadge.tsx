"use client";

import { CalendarDays } from "lucide-react";
import { dueLabel, dueWord } from "@/lib/time";
import { useLabelDay } from "./use-day-start";

/**
 * An item's due day, or span from `from` to `due` ("This week"), in words,
 * with its tone: overdue while still open, due today, or neither. Until
 * the browser knows the viewer's day (server render and hydration), it goes
 * by the server's guess (useLabelDay). Without the browser's locale it shows
 * only the labels that need none ("This weekend"), else the plain date.
 */
export function useDueLabel(
  due: string,
  from: string | null | undefined,
  done: boolean,
): { label: string; tone: "overdue" | "today" | null } {
  const { today, locale } = useLabelDay();
  const label =
    today && locale !== null
      ? dueLabel(due, today, from, locale)
      : ((today && dueWord(due, today, from)) ?? (from ? `${from} – ${due}` : due));
  const tone =
    today && !done && due < today ? "overdue" : today && !done && due === today ? "today" : null;
  return { label, tone };
}

// An item's due day as a small pill (useDueLabel): red once it's overdue and
// still open, stronger on its last day.
export function DueBadge({
  due,
  from,
  done,
}: {
  due: string;
  from?: string | null;
  done: boolean;
}) {
  const { label, tone } = useDueLabel(due, from, done);
  const toneClass =
    tone === "overdue"
      ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400"
      : tone === "today"
        ? "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
        : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${toneClass}`}
    >
      <CalendarDays className="size-3" />
      {label}
    </span>
  );
}

/** When something's due, inside a sentence: "due this weekend", "due 21 Nov". */
export function DueText({ due, from }: { due: string; from: string | null }) {
  const { today } = useLabelDay();
  const { label } = useDueLabel(due, from, true);
  const word = today && dueWord(due, today, from);
  return <>{word ? word.toLowerCase() : label}</>;
}
