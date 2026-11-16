"use client";

import {
  CalendarDays,
  CalendarRange,
  CircleDashed,
  ListFilter,
  Tag,
  UserRound,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import type { DateRange } from "react-day-picker";
import type { AssigneeView } from "@/core/members";
import {
  activeFilterCount,
  DUE_FILTERS,
  type DueFilter,
  type ItemFilters,
  NO_FILTERS,
} from "@/lib/filters";
import { localDate, localDay, spanDates } from "@/lib/time";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { useToday } from "./use-day-start";
import { assigneeName, UserAvatar } from "./UserAvatar";

const toggled = <T,>(list: T[], value: T, on: boolean) =>
  on ? [...list, value] : list.filter((v) => v !== value);

/**
 * The header's Filter menu: whose items (Me, No assignee, anyone on the
 * board's lists; several at once), their labels (by name, in every list
 * with one; any of them), when they're due (quick choices and a date range; any of them),
 * and where finished items show. Ticking keeps the menu open for the next.
 * `people` and `labels` are everyone and every label on the board's lists.
 */
export function FilterMenu({
  filters,
  onChange,
  people,
  labels,
  viewerId,
}: {
  filters: ItemFilters;
  onChange: (filters: ItemFilters) => void;
  people: AssigneeView[];
  /** Each label name once, with the emoji of the first list that has it. */
  labels: Array<{ name: string; emoji: string | null }>;
  viewerId: string;
}) {
  const today = useToday();
  const button = useRef<HTMLButtonElement>(null);
  const [rangeOpen, setRangeOpen] = useState(false);
  const count = activeFilterCount(filters);
  const me = people.find((p) => p.userId === viewerId);
  const others = people.filter((p) => p.userId !== viewerId);
  const set = (change: Partial<ItemFilters>) => onChange({ ...filters, ...change });
  const person = (userId: string) => (on: boolean) =>
    set({ assignees: toggled(filters.assignees, userId, on) });
  const byPerson = filters.assignees.length + (filters.unassigned ? 1 : 0);
  const byLabel = filters.labels.length + (filters.unlabelled ? 1 : 0);
  const byDue = filters.due.length + (filters.dueRange ? 1 : 0);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            // Just the icon on phones, where the header is full, with the
            // count on its corner, so it's no wider than its neighbours.
            <Button
              ref={button}
              variant="outline"
              size="sm"
              aria-label={count > 0 ? `Filter (${count} on)` : "Filter"}
              className="relative"
            >
              <ListFilter />
              <span className="hidden sm:inline">Filter</span>
              {count > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-4 rounded-full bg-neutral-900 px-1 text-center text-[10px] leading-4 tabular-nums text-white sm:static sm:px-1.5 dark:bg-neutral-100 dark:text-neutral-900">
                  {count}
                </span>
              )}
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <UserRound />
                Assignee
                {byPerson > 0 && <DropdownMenuShortcut>{byPerson}</DropdownMenuShortcut>}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-56">
                {me && (
                  <DropdownMenuCheckboxItem
                    checked={filters.assignees.includes(me.userId)}
                    onCheckedChange={person(me.userId)}
                  >
                    <UserAvatar user={me} size={18} />
                    Me
                  </DropdownMenuCheckboxItem>
                )}
                <DropdownMenuCheckboxItem
                  checked={filters.unassigned}
                  onCheckedChange={(on) => set({ unassigned: on })}
                >
                  <CircleDashed className="text-neutral-400" />
                  No assignee
                </DropdownMenuCheckboxItem>
                {others.length > 0 && <DropdownMenuSeparator />}
                {others.map((p) => (
                  <DropdownMenuCheckboxItem
                    key={p.userId}
                    checked={filters.assignees.includes(p.userId)}
                    onCheckedChange={person(p.userId)}
                  >
                    <UserAvatar user={p} size={18} />
                    <span className="truncate">{assigneeName(p)}</span>
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Tag />
                Label
                {byLabel > 0 && <DropdownMenuShortcut>{byLabel}</DropdownMenuShortcut>}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-80 w-56 overflow-y-auto">
                <DropdownMenuCheckboxItem
                  checked={filters.unlabelled}
                  onCheckedChange={(on) => set({ unlabelled: on })}
                >
                  <CircleDashed className="text-neutral-400" />
                  No labels
                </DropdownMenuCheckboxItem>
                {labels.length > 0 && <DropdownMenuSeparator />}
                {labels.map(({ name, emoji }) => (
                  <DropdownMenuCheckboxItem
                    key={name}
                    checked={filters.labels.includes(name)}
                    onCheckedChange={(on) => set({ labels: toggled(filters.labels, name, on) })}
                  >
                    {/* Same width with or without an emoji, so names line up. */}
                    <span aria-hidden className="w-4 shrink-0 text-center text-sm leading-none">
                      {emoji}
                    </span>
                    <span className="truncate">{name}</span>
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <CalendarDays />
                Due
                {byDue > 0 && <DropdownMenuShortcut>{byDue}</DropdownMenuShortcut>}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-48">
                {DUE_FILTERS.map(([key, label]) => (
                  <DropdownMenuCheckboxItem
                    key={key}
                    checked={filters.due.includes(key)}
                    onCheckedChange={(on) => set({ due: toggled<DueFilter>(filters.due, key, on) })}
                  >
                    {label}
                  </DropdownMenuCheckboxItem>
                ))}
                <DropdownMenuSeparator />
                {filters.dueRange && (
                  <DropdownMenuCheckboxItem
                    checked
                    onCheckedChange={() => set({ dueRange: null })}
                  >
                    {spanDates(filters.dueRange.from, filters.dueRange.to, today ?? "")}
                  </DropdownMenuCheckboxItem>
                )}
                <DropdownMenuItem onClick={() => setRangeOpen(true)}>
                  <CalendarRange />
                  {filters.dueRange ? "Change dates…" : "Dates…"}
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>Finished items</DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              checked={filters.doneToday}
              onCheckedChange={(on) => set({ doneToday: on })}
            >
              Done today
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={filters.doneThisWeek}
              onCheckedChange={(on) => set({ doneThisWeek: on })}
            >
              Done this week
            </DropdownMenuCheckboxItem>
          </DropdownMenuGroup>
          {count > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onChange(NO_FILTERS)}>
                <X />
                Clear filters
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Opened from Due › Dates…, once the menu has closed, beside the same
          button. */}
      <Popover open={rangeOpen} onOpenChange={setRangeOpen}>
        <PopoverContent
          anchor={button}
          align="end"
          finalFocus={button}
          className="w-auto p-0"
        >
          {rangeOpen && (
            <DueRange
              range={filters.dueRange}
              today={today}
              onApply={(dueRange) => {
                setRangeOpen(false);
                set({ dueRange });
              }}
            />
          )}
        </PopoverContent>
      </Popover>
    </>
  );
}

/** A calendar to pick the first and last day; one day alone is that day. */
function DueRange({
  range,
  today,
  onApply,
}: {
  range: ItemFilters["dueRange"];
  today: string | null;
  onApply: (range: ItemFilters["dueRange"]) => void;
}) {
  const [picked, setPicked] = useState<DateRange | undefined>(
    range ? { from: localDate(range.from), to: localDate(range.to) } : undefined,
  );
  const from = picked?.from && localDay(picked.from);
  const to = picked?.to ? localDay(picked.to) : from;
  return (
    <div>
      <Calendar
        mode="range"
        selected={picked}
        onSelect={setPicked}
        defaultMonth={picked?.from ?? (today ? localDate(today) : undefined)}
        today={today ? localDate(today) : undefined}
        weekStartsOn={1}
      />
      <div className="flex items-center justify-between gap-2 border-t border-neutral-200 px-3 py-2 dark:border-neutral-800">
        <span aria-live="polite" className="text-xs text-neutral-500">
          {from && to ? spanDates(from, to, today ?? "") : "Pick the first and last day"}
        </span>
        <Button
          type="button"
          size="xs"
          disabled={!from || !to}
          onClick={() => from && to && onApply({ from, to })}
        >
          Apply
        </Button>
      </div>
    </div>
  );
}
