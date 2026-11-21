"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import {
  MAX_REPEAT_EVERY,
  nextDue,
  ordinal,
  type Repeat,
  REPEAT_ONS,
  REPEAT_UNITS,
  type RepeatOn,
  repeatOnName,
  type RepeatUnit,
} from "@/lib/repeat";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { backLabel, useComesBack } from "./RepeatBadge";
import { useToday } from "./use-day-start";

const QUICK_REPEATS: Array<[string, Repeat]> = [
  ["Daily", { every: 1, unit: "day" }],
  ["Weekly", { every: 1, unit: "week" }],
  ["Monthly", { every: 1, unit: "month" }],
];

// Daily, Weekly and Monthly whichever days they keep to.
const sameGap = (a: Repeat | null, b: Repeat | null) =>
  a?.every === b?.every && a?.unit === b?.unit;
const sameRepeat = (a: Repeat | null, b: Repeat | null) =>
  sameGap(a, b) &&
  (a?.on ?? null) === (b?.on ?? null) &&
  (a?.day ?? null) === (b?.day ?? null);

/** `every` `unit`, keeping the days `was` kept to when the new unit can. */
function withGap(every: number, unit: RepeatUnit, was: Repeat | null): Repeat {
  if (unit === "month" && was?.day) return { every, unit, day: was.day };
  return unit !== "day" && was?.on
    ? { every, unit, on: was.on }
    : { every, unit };
}

const DAYS_OF_MONTH = Array.from({ length: 31 }, (_, i): [string, string] => [
  String(i + 1),
  `the ${ordinal(i + 1)}`,
]);

/**
 * How often a task comes round again: Daily, Weekly, Monthly, or Custom for
 * "every 3 days" and the like, and for a weekly or monthly rule, the days it
 * keeps to ("on weekends"), or for a monthly one, a date ("on the 1st"). The count saves on blur or Enter, the unit and
 * days as soon as they're picked. Keyed by item, so a draft never carries
 * over.
 */
export function RepeatPicker({
  repeat,
  completedAt,
  disabled,
  onChange,
}: {
  repeat: Repeat | null;
  completedAt: number | null;
  disabled: boolean;
  onChange: (repeat: Repeat | null) => void;
}) {
  const isQuick = QUICK_REPEATS.some(([, r]) => sameGap(r, repeat));
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
  const back = useComesBack(repeat, completedAt);
  const today = useToday();
  const editing = custom || (repeat !== null && !isQuick);
  // Only a weekly or monthly rule keeps to days: daily would skip most.
  const keepsToDays = repeat !== null && repeat.unit !== "day";

  function save(nextEvery: string, nextUnit: RepeatUnit) {
    const n = Number(nextEvery);
    if (!Number.isInteger(n) || n < 1 || n > MAX_REPEAT_EVERY) {
      // Not a count yet: put the saved one back.
      setEvery(String(repeat?.every ?? ""));
      return;
    }
    const next = withGap(n, nextUnit, repeat);
    if (!sameRepeat(next, repeat)) onChange(next);
  }

  // A rule on a date keeps to it; any other counts from when it's done.
  const rule = repeat?.day
    ? `Keeps to the ${ordinal(repeat.day)}${
        repeat.day > 28 ? " (a shorter month's last day)" : ""
      }, whenever it's done`
    : "Counts from when it's done";
  const hint =
    repeat && today
      ? `${rule}: finish it today and it's back ${backLabel(
          nextDue(today, repeat),
          today,
        ).replace("Tomorrow", "tomorrow")}.`
      : repeat?.day
        ? `${rule}.`
        : `${rule}: finish it late and the next one moves too.`;

  const pressed =
    "border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-800 hover:text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900";
  return (
    // Its choices and rule are the app's words, shown in replays.
    <div data-replay-safe className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {QUICK_REPEATS.map(([label, r]) => (
          <Button
            key={label}
            type="button"
            variant="outline"
            size="xs"
            disabled={disabled}
            aria-pressed={!editing && sameGap(r, repeat)}
            data-repeat-choice
            onClick={() => {
              setCustom(false);
              const next = withGap(r.every, r.unit, repeat);
              if (!sameRepeat(next, repeat)) onChange(next);
            }}
            className={!editing && sameGap(r, repeat) ? pressed : ""}
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
      {(editing || keepsToDays) && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300">
          {editing && (
            <>
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
              <MenuSelect
                label="Repeat unit"
                value={unit}
                options={REPEAT_UNITS.map((u) => [
                  u,
                  every === "1" ? u : `${u}s`,
                ])}
                disabled={disabled}
                onChange={(u) => {
                  setUnit(u);
                  save(every || "1", u);
                }}
              />
            </>
          )}
          {keepsToDays && repeat && (
            <>
              {editing ? "on" : "On"}
              <MenuSelect
                label="Repeat on"
                value={repeat.day ? "date" : (repeat.on ?? "any")}
                options={[
                  ["any", "any day"],
                  ["weekend", repeatOnName("weekend")],
                  null,
                  ...REPEAT_ONS.filter((on) => on !== "weekend").map(
                    (on): [RepeatOn | "date", string] => [on, repeatOnName(on)],
                  ),
                  // A fixed day of the month, from today's to start with.
                  ...(repeat.unit === "month"
                    ? [null, ["date", "a date"] as ["date", string]]
                    : []),
                ]}
                disabled={disabled}
                onChange={(on) => {
                  const gap = { every: repeat.every, unit: repeat.unit };
                  if (on === "any") onChange(gap);
                  else if (on === "date") {
                    onChange({ ...gap, day: today ? Number(today.slice(8)) : 1 });
                  } else onChange({ ...gap, on });
                }}
              />
              {repeat.day && (
                <MenuSelect
                  label="Day of the month"
                  value={String(repeat.day)}
                  options={DAYS_OF_MONTH}
                  disabled={disabled}
                  onChange={(day) => onChange({ ...repeat, day: Number(day) })}
                />
              )}
            </>
          )}
        </div>
      )}
      {repeat && (
        <p className="text-xs text-neutral-400">
          {back ? `Next: ${back}.` : hint}
        </p>
      )}
    </div>
  );
}

/**
 * A small menu that picks one of `options`, shaped like the count beside it;
 * a null option is a line between groups.
 */
function MenuSelect<T extends string>({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<[T, string] | null>;
  disabled: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={label}
        disabled={disabled}
        className="flex h-6 items-center gap-0.5 rounded-md border border-neutral-200 px-1.5 text-xs transition hover:bg-accent disabled:opacity-50 dark:border-neutral-800"
      >
        {options.find((o) => o?.[0] === value)?.[1]}
        <ChevronDown className="size-3 opacity-50" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-auto min-w-28">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next: T) => next !== value && onChange(next)}
        >
          {options.map((o, i) =>
            o ? (
              <DropdownMenuRadioItem key={o[0]} value={o[0]} closeOnClick>
                {o[1]}
              </DropdownMenuRadioItem>
            ) : (
              <DropdownMenuSeparator key={i} />
            ),
          )}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
