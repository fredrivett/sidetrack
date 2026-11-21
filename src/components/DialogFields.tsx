"use client";

import { CalendarDays, ExternalLink, Repeat as RepeatIcon, Sparkles, UserRound } from "lucide-react";
import { useState } from "react";
import type { AssigneeView } from "@/core/members";
import type { Repeat } from "@/lib/repeat";
import type { Due } from "@/lib/time";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDueLabel } from "./DueBadge";
import { DueDatePicker } from "./DueDatePicker";
import { shortLabel } from "./RepeatBadge";
import { RepeatPicker } from "./RepeatPicker";
import { AvatarStack, assigneeNames } from "./UserAvatar";

/**
 * What the item and list dialogs share: a section label, the chip styles,
 * and the chips under the title that show and set an item's due date,
 * repeat and assignees, whether it's saved (ItemDetailDialog) or still a
 * draft (NewItemDialog).
 */

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <span data-replay-safe className="block text-xs font-medium text-neutral-500">
        {label}
      </span>
      {children}
    </div>
  );
}

/** A field in the dialog's chip bar, set. */
export const CHIP =
  "inline-flex h-7 max-w-full min-w-0 shrink-0 items-center gap-1.5 rounded-full border border-input px-2.5 text-sm transition hover:bg-muted aria-disabled:pointer-events-none aria-disabled:opacity-50 data-popup-open:bg-muted touch:h-9 touch:px-3 [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-muted-foreground";
/** A field in the chip bar with nothing set: dashed, its name in grey. */
export const EMPTY_CHIP = `${CHIP} border-dashed text-muted-foreground hover:text-foreground`;

/**
 * The due date as a chip: when it's due, red once overdue and amber on the
 * day, opening the quick dates and the calendar. Picking one closes it.
 */
export function DueChip({
  due,
  done,
  disabled,
  onChange,
  open,
  setOpen,
  smart,
}: {
  due: Due | null;
  done: boolean;
  disabled: boolean;
  onChange: (due: Due | null) => void;
  /** Open, as the D shortcut leaves it. */
  open: boolean;
  setOpen: (open: boolean) => void;
  /**
   * For a saved item, its smart due date's rule (null: a plain date) and
   * the Smart tab, which the popover opens on while it has one.
   */
  smart?: { rule: string | null; panel: (onPlain: () => void) => React.ReactNode };
}) {
  // The tab picked since it opened; until then, Smart for a smart date,
  // however it opened (the D shortcut opens it through `open`).
  const [picked, setPicked] = useState<"date" | "smart" | null>(null);
  if (!open && picked !== null) setPicked(null);
  const tab = picked ?? (smart?.rule ? "smart" : "date");
  const setTab = setPicked;
  const waiting = smart?.rule && !due;
  return (
    <Popover open={open} onOpenChange={(next) => setOpen(next && !disabled)}>
      <PopoverTrigger
        aria-disabled={disabled || undefined}
        title={smart?.rule ? `Smart: ${smart.rule}` : undefined}
        className={due || waiting ? CHIP : EMPTY_CHIP}
      >
        {smart?.rule ? <Sparkles /> : <CalendarDays />}
        {due ? (
          <DueChipLabel due={due} done={done} />
        ) : waiting ? (
          <span data-replay-safe className="truncate">
            <span className="text-muted-foreground">Waiting: </span>
            {smart.rule}
          </span>
        ) : (
          <span data-replay-safe>Due date</span>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] space-y-2 p-2">
        {smart && (
          <div
            data-replay-safe
            role="tablist"
            aria-label="Due date kind"
            className="flex w-max gap-0.5 rounded-md bg-muted p-0.5"
          >
            {(["date", "smart"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className="rounded px-2.5 py-0.5 text-xs text-muted-foreground aria-selected:bg-background aria-selected:text-foreground aria-selected:shadow-xs"
              >
                {t === "date" ? "Date" : "Smart"}
              </button>
            ))}
          </div>
        )}
        {smart && tab === "smart" ? (
          smart.panel(() => setTab("date"))
        ) : (
          <DueDatePicker
            due={due}
            done={done}
            disabled={disabled}
            onChange={(next) => {
              setOpen(false);
              onChange(next);
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

function DueChipLabel({ due, done }: { due: Due; done: boolean }) {
  const { label, tone } = useDueLabel(due.dueDate, due.dueFrom, done);
  return (
    <span
      data-replay-safe
      className={
        tone === "overdue"
          ? "text-red-600 dark:text-red-400"
          : tone === "today"
            ? "text-amber-700 dark:text-amber-300"
            : ""
      }
    >
      <span className="sr-only">Due </span>
      {label}
    </span>
  );
}

/** How the item repeats as a chip, opening the repeat picker. */
export function RepeatChip({
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
  return (
    <Popover>
      <PopoverTrigger aria-disabled={disabled || undefined} className={repeat ? CHIP : EMPTY_CHIP}>
        <RepeatIcon />
        <span data-replay-safe>{repeat ? shortLabel(repeat) : "Repeat"}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] p-2">
        <RepeatPicker
          repeat={repeat}
          completedAt={completedAt}
          disabled={disabled}
          onChange={onChange}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Who it's assigned to as a chip, opening `children`: the assignee options.
 * Open, as the A shortcut leaves it.
 */
export function AssigneeChip({
  assigned,
  disabled,
  open,
  setOpen,
  children,
}: {
  assigned: AssigneeView[];
  disabled: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        aria-disabled={disabled || undefined}
        title="Assignees (A)"
        className={assigned.length ? CHIP : EMPTY_CHIP}
      >
        {assigned.length ? (
          <>
            <AvatarStack users={assigned} size={18} ringClassName="ring-popover" />
            <span className="truncate">{assigneeNames(assigned)}</span>
          </>
        ) : (
          <>
            <UserRound />
            <span data-replay-safe>Unassigned</span>
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent data-assignee-picker align="start" className="w-56">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * A one-line text field as a chip, such as a list's homepage: dashed with
 * `label` while empty, `children` once set. It opens an input, where Enter
 * saves and Escape leaves it as it was. `validate` turns a bad value away
 * there, with its message under the input, so a typo is never lost to a
 * toast; clearing the input saves no value.
 */
export function TextChip({
  icon,
  label,
  value,
  placeholder,
  validate,
  onSave,
  href,
  hrefLabel,
  disabled = false,
  className,
  inputClassName,
  children,
}: {
  icon: React.ReactNode;
  /** The field's name: the empty chip's text, and the input's label. */
  label: string;
  value: string;
  placeholder: string;
  /** A message saying what's wrong with `next`, or null when it's fine. */
  validate?: (next: string) => string | null;
  onSave: (next: string) => void;
  /** A link the set value opens, such as the homepage itself. */
  href?: string | null;
  hrefLabel?: string;
  disabled?: boolean;
  /** The chip's look while set, when it isn't the plain chip's. */
  className?: string;
  inputClassName?: string;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  function save() {
    const next = draft.trim();
    if (next === value) {
      setOpen(false);
      return;
    }
    const problem = next ? (validate?.(next) ?? null) : null;
    if (problem) {
      setError(problem);
      return;
    }
    setOpen(false);
    onSave(next);
  }
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next && disabled) return;
        // Each opening starts from the saved value.
        if (next) {
          setDraft(value);
          setError(null);
        }
        setOpen(next);
      }}
    >
      <PopoverTrigger
        aria-disabled={disabled || undefined}
        title={label}
        className={value ? (className ?? CHIP) : EMPTY_CHIP}
      >
        {icon}
        {value ? children : <span data-replay-safe>{label}</span>}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] space-y-2 p-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            // Its own form, so Enter here doesn't submit the dialog's.
            e.stopPropagation();
            save();
          }}
          className="flex items-center gap-2"
        >
          <Input
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
            placeholder={placeholder}
            aria-label={label}
            aria-invalid={error ? true : undefined}
            className={inputClassName}
          />
          <Button type="submit" size="sm">
            Save
          </Button>
        </form>
        {error && <p className="px-0.5 text-xs text-destructive">{error}</p>}
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 px-0.5 text-xs font-medium text-blue-700 hover:underline dark:text-blue-300"
          >
            {hrefLabel}
            <ExternalLink className="size-3" />
          </a>
        )}
      </PopoverContent>
    </Popover>
  );
}
