"use client";

import { WHOSE_FILTERS, type WhoseFilter } from "@/lib/whose";

const LABELS: Record<WhoseFilter, string> = {
  all: "All",
  mine: "Mine",
  theirs: "Theirs",
  unassigned: "Unassigned",
};

/**
 * All / Mine / Theirs / Unassigned chips, each with its count of open items
 * when `count` is given.
 */
export function WhoseFilterBar({
  value,
  onChange,
  count,
}: {
  value: WhoseFilter;
  onChange: (filter: WhoseFilter) => void;
  count?: (filter: WhoseFilter) => number;
}) {
  return (
    <div role="group" aria-label="Whose items" className="flex flex-wrap gap-1">
      {WHOSE_FILTERS.map((key) => {
        const open = count?.(key) ?? 0;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={value === key}
            onClick={() => onChange(key)}
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
              value === key
                ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            }`}
          >
            {LABELS[key]}
            {open > 0 && <span className="ml-1 tabular-nums opacity-60">{open}</span>}
          </button>
        );
      })}
    </div>
  );
}
