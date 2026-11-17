"use client";

import { useState } from "react";
import {
  MAX_REPEAT_EVERY,
  type Repeat,
  REPEAT_UNITS,
  type RepeatUnit,
} from "@/lib/repeat";
import { Button } from "@/components/ui/button";
import { useComesBack } from "./RepeatBadge";

const QUICK_REPEATS: Array<[string, Repeat]> = [
  ["Daily", { every: 1, unit: "day" }],
  ["Weekly", { every: 1, unit: "week" }],
  ["Monthly", { every: 1, unit: "month" }],
];

const sameRepeat = (a: Repeat | null, b: Repeat | null) =>
  a?.every === b?.every && a?.unit === b?.unit;

/**
 * How often a task comes round again: Daily, Weekly, Monthly, or Custom for
 * "every 3 days" and the like. The count saves on blur or Enter, the unit as
 * soon as it's picked. Keyed by item, so a draft never carries over.
 */
export function RepeatPicker({
  repeat,
  completedAt,
  due = null,
  disabled,
  onChange,
}: {
  repeat: Repeat | null;
  completedAt: number | null;
  /** When it was due, for a week or weekend that comes back as one. */
  due?: { dueDate: string | null; dueFrom: string | null } | null;
  disabled: boolean;
  onChange: (repeat: Repeat | null) => void;
}) {
  const isQuick = QUICK_REPEATS.some(([, r]) => sameRepeat(r, repeat));
  const [custom, setCustom] = useState(false);
  const [every, setEvery] = useState(String(repeat?.every ?? ""));
  const [unit, setUnit] = useState<RepeatUnit>(repeat?.unit ?? "day");
  // A save or a quick button changed the rule: show it.
  const [shown, setShown] = useState(repeat);
  if (!sameRepeat(repeat, shown)) {
    setShown(repeat);
    setEvery(String(repeat?.every ?? ""));
    setUnit(repeat?.unit ?? "day");
  }
  const back = useComesBack(repeat, completedAt, due);
  const editing = custom || (repeat !== null && !isQuick);

  function save(nextEvery: string, nextUnit: RepeatUnit) {
    const n = Number(nextEvery);
    if (!Number.isInteger(n) || n < 1 || n > MAX_REPEAT_EVERY) {
      // Not a count yet: put the saved one back.
      setEvery(String(repeat?.every ?? ""));
      return;
    }
    const next = { every: n, unit: nextUnit };
    if (!sameRepeat(next, repeat)) onChange(next);
  }

  const pressed =
    "border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-800 hover:text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900";
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {QUICK_REPEATS.map(([label, r]) => (
          <Button
            key={label}
            type="button"
            variant="outline"
            size="xs"
            disabled={disabled}
            aria-pressed={!editing && sameRepeat(r, repeat)}
            data-repeat-choice
            onClick={() => {
              setCustom(false);
              onChange(r);
            }}
            className={!editing && sameRepeat(r, repeat) ? pressed : ""}
          >
            {label}
          </Button>
        ))}
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={disabled}
          aria-pressed={editing}
          onClick={() => setCustom(true)}
          className={editing ? pressed : ""}
        >
          Custom
        </Button>
        {repeat && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={disabled}
            data-repeat-choice
            onClick={() => {
              setCustom(false);
              onChange(null);
            }}
          >
            Clear
          </Button>
        )}
      </div>
      {editing && (
        <div className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300">
          Every
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_REPEAT_EVERY}
            value={every}
            placeholder="3"
            disabled={disabled}
            onChange={(e) => setEvery(e.target.value)}
            onBlur={(e) => {
              // Clicking Daily, Weekly, Monthly or Clear replaces the draft,
              // so don't save it first.
              if (
                e.relatedTarget instanceof HTMLElement &&
                e.relatedTarget.closest("[data-repeat-choice]")
              ) {
                return;
              }
              save(every, unit);
            }}
            onKeyDown={(e) => {
              // Enter commits the count; in the new-item dialog it mustn't
              // also submit the form with the old rule.
              if (e.key === "Enter") {
                e.preventDefault();
                save(every, unit);
              }
            }}
            aria-label="Repeat every"
            className="h-6 w-14 rounded-md border border-neutral-200 bg-transparent px-1.5 text-xs dark:border-neutral-800"
          />
          <select
            value={unit}
            disabled={disabled}
            onChange={(e) => {
              const u = e.target.value as RepeatUnit;
              setUnit(u);
              save(every || "1", u);
            }}
            aria-label="Repeat unit"
            className="h-6 rounded-md border border-neutral-200 bg-transparent px-1 text-xs dark:border-neutral-800 dark:bg-neutral-900"
          >
            {REPEAT_UNITS.map((u) => (
              <option key={u} value={u}>
                {every === "1" ? u : `${u}s`}
              </option>
            ))}
          </select>
        </div>
      )}
      {repeat && (
        <p className="text-xs text-neutral-400">
          {back
            ? `Next: ${back}.`
            : "Counts from when it's done: finish it late and the next one moves too."}
        </p>
      )}
    </div>
  );
}
