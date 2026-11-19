"use client";

import { CalendarDays } from "lucide-react";
import { useRef, useState } from "react";
import {
  localDate,
  localDay,
  parseDue,
  quickDues,
  sameDue,
  spanDates,
  type Due,
} from "@/lib/time";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DueBadge } from "./DueBadge";
import { useToday } from "./use-day-start";


/**
 * A popover for any day the quick buttons don't offer: type one ("fri",
 * "in 2 weeks") and press Enter, or click it on the calendar, which follows
 * what's typed and shows a span ("next week") as a range. `today` is the
 * app's day (with its 4am turnover), so the calendar marks the same day the
 * Today button sets. Weeks start on Monday, as "Next week" does.
 */
function DueCalendar({
  due,
  today,
  disabled,
  onChange,
}: {
  due: Due | null;
  today: string | null;
  disabled: boolean;
  onChange: (due: Due) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [month, setMonth] = useState<Date>();
  const input = useRef<HTMLInputElement>(null);
  const typed = text.trim() && today ? parseDue(text, today) : null;
  const shown = typed ?? due;
  const from = shown?.dueFrom ? localDate(shown.dueFrom) : null;
  const to = shown ? localDate(shown.dueDate) : null;

  function openChange(next: boolean) {
    setOpen(next);
    setText("");
    const day = due?.dueFrom ?? due?.dueDate ?? today;
    setMonth(day ? localDate(day) : undefined);
  }

  function pick(next: Due) {
    setOpen(false);
    if (!sameDue(next, due)) onChange(next);
  }

  return (
    <Popover open={open} onOpenChange={openChange}>
      <PopoverTrigger
        render={
          <Button type="button" variant="outline" size="xs" disabled={disabled} />
        }
      >
        <CalendarDays />
        Pick date
      </PopoverTrigger>
      <PopoverContent align="start" initialFocus={input} className="w-auto p-0">
        <div className="space-y-1.5 px-2 pt-2 contain-inline-size">
          <Input
            ref={input}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              const next = today && parseDue(e.target.value, today);
              if (next) setMonth(localDate(next.dueFrom ?? next.dueDate));
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing && typed) {
                e.preventDefault();
                pick(typed);
              }
            }}
            placeholder="fri, in 2 weeks, 27 nov…"
            aria-label="Type a due date"
            className="h-7"
          />
          {text.trim() && (
            <p
              aria-live="polite"
              className="flex h-5 items-center justify-between px-1 text-xs text-muted-foreground"
            >
              {typed ? (
                <>
                  <span className="text-foreground">
                    {typed.dueFrom
                      ? spanDates(typed.dueFrom, typed.dueDate, today ?? "", true)
                      : localDate(typed.dueDate).toLocaleDateString(undefined, {
                          weekday: "long",
                          day: "numeric",
                          month: "long",
                          year:
                            typed.dueDate.slice(0, 4) === today?.slice(0, 4)
                              ? undefined
                              : "numeric",
                        })}
                  </span>
                  <Kbd>↵</Kbd>
                </>
              ) : (
                "Not a date"
              )}
            </p>
          )}
        </div>
        <Calendar
          mode="single"
          required
          selected={to && !from ? to : undefined}
          // A span as the calendar's range styling; picking a day sets that
          // day alone.
          modifiers={
            from && to
              ? { range_start: from, range_middle: { after: from, before: to }, range_end: to }
              : undefined
          }
          month={month}
          onMonthChange={setMonth}
          today={today ? localDate(today) : undefined}
          weekStartsOn={1}
          onSelect={(date) => pick({ dueFrom: null, dueDate: localDay(date) })}
        />
      </PopoverContent>
    </Popover>
  );
}

/** Quick due-date buttons, a date picker for anything else, and Clear. */
export function DueDatePicker({
  due,
  done,
  disabled,
  onChange,
}: {
  due: Due | null;
  done: boolean;
  disabled: boolean;
  onChange: (due: Due | null) => void;
}) {
  const today = useToday();
  const quick = today ? quickDues(today) : [];
  return (
    // Quick dates and the picked day: the app's words, shown in replays.
    <div data-replay-safe className="flex flex-wrap items-center gap-1.5">
      {/* A pressed quick button already says when it's due. */}
      {due && !quick.some(([, q]) => sameDue(q, due)) && (
        <DueBadge due={due.dueDate} from={due.dueFrom} done={done} />
      )}
      {quick.map(([label, q]) => (
        <Button
          key={label}
          type="button"
          variant="outline"
          size="xs"
          disabled={disabled}
          aria-pressed={sameDue(due, q)}
          onClick={() => onChange(q)}
          className={
            sameDue(due, q)
              ? "border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-800 hover:text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
              : ""
          }
        >
          {label}
        </Button>
      ))}
      <DueCalendar due={due} today={today} disabled={disabled} onChange={onChange} />
      {due && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={disabled}
          onClick={() => onChange(null)}
        >
          Clear
        </Button>
      )}
    </div>
  );
}
