import { z } from "zod";
import { isDay, weekSpan } from "./time";

/**
 * The viewer's own filters, set from the header and applied to every view:
 * whose items, their labels, when they're due, and where finished items
 * show. Saved per
 * person, so collaborators on a list each see it their own way.
 */

/** The quick due-date choices, in the order the menu offers them. */
export const DUE_FILTERS = [
  ["overdue", "Overdue"],
  ["today", "Today"],
  ["this-week", "This week"],
  ["next-week", "Next week"],
  ["none", "No date"],
] as const;
export type DueFilter = (typeof DUE_FILTERS)[number][0];

const day = z.string().refine(isDay);

export const itemFiltersSchema = z.object({
  /** People, by user id (the viewer's own for "Me"); empty is everyone. */
  assignees: z.array(z.string()).max(100),
  /** Items with nobody on them, alongside `assignees`. */
  unassigned: z.boolean(),
  /** Label names, matched in every list that has one; empty is any. */
  labels: z.array(z.string()).max(200),
  /** Items with no labels, alongside `labels`. */
  unlabelled: z.boolean(),
  /** Quick due choices; an item matching any of these or `dueRange` shows. */
  due: z
    .array(z.enum(DUE_FILTERS.map(([key]) => key)))
    .max(DUE_FILTERS.length)
    .refine((keys) => new Set(keys).size === keys.length),
  /** Due on any day from one to the other, inclusive. */
  dueRange: z
    .object({ from: day, to: day })
    .refine((r) => r.from <= r.to)
    .nullable(),
  /** Items finished today stay in their list, crossed out, until tomorrow. */
  doneToday: z.boolean(),
  /** Each list's header counts what was done this week; tapping it shows them. */
  doneThisWeek: z.boolean(),
});
export type ItemFilters = z.infer<typeof itemFiltersSchema>;

export const NO_FILTERS: ItemFilters = {
  assignees: [],
  unassigned: false,
  labels: [],
  unlabelled: false,
  due: [],
  dueRange: null,
  doneToday: true,
  doneThisWeek: true,
};

/** Saved filters, or none when they're missing or no longer valid. */
export function parseItemFilters(value: unknown): ItemFilters {
  const parsed = itemFiltersSchema.safeParse(value);
  return parsed.success ? parsed.data : NO_FILTERS;
}

/** How many filters differ from the defaults, for the header's badge. */
export function activeFilterCount(f: ItemFilters): number {
  return (
    f.assignees.length +
    (f.unassigned ? 1 : 0) +
    f.labels.length +
    (f.unlabelled ? 1 : 0) +
    f.due.length +
    (f.dueRange ? 1 : 0) +
    (f.doneToday ? 0 : 1) +
    (f.doneThisWeek ? 0 : 1)
  );
}

/** Whether the due filters need today's date, which the server render lacks. */
export function filtersByDue(f: ItemFilters): boolean {
  return f.due.length > 0 || f.dueRange !== null;
}

type Due = { dueDate: string | null; dueFrom?: string | null };

function matchesDue(due: Due, f: ItemFilters, today: string | null): boolean {
  if (!filtersByDue(f)) return true;
  if (!today) return false;
  const last = due.dueDate;
  const first = due.dueFrom ?? last;
  // A span ("this week") is due on every day in it, so it matches any range
  // it overlaps.
  const overlaps = (from: string, to: string) =>
    last !== null && first !== null && first <= to && last >= from;
  const thisWeek = weekSpan(today, 0, "week");
  const nextWeek = weekSpan(today, 1, "week");
  return (
    f.due.some((key) => {
      switch (key) {
        case "overdue":
          return last !== null && last < today;
        case "today":
          return overlaps(today, today);
        case "this-week":
          // What's left of it: earlier days are Overdue.
          return overlaps(today, thisWeek.dueDate);
        case "next-week":
          return overlaps(nextWeek.dueFrom ?? nextWeek.dueDate, nextWeek.dueDate);
        case "none":
          return last === null;
      }
    }) || (f.dueRange !== null && overlaps(f.dueRange.from, f.dueRange.to))
  );
}

type Ownable = { assigneeIds: string[]; createdBy: string | null; projectId: string };

/**
 * Whether `item` is the viewer's to think about: assigned to them, or
 * unassigned and added by them (an agent's items are its key owner's). An
 * unassigned sub-item goes with its parent, so a step under someone else's
 * task stays theirs and one added to the viewer's stays the viewer's. An
 * item whose creator is unknown or can no longer open its list (they left,
 * or it's feedback from outside it) counts for everyone, as before
 * creators were kept. `canOpen` says who can open a list. The Agenda and
 * its greeting show only these.
 */
export function isYours(
  item: Ownable,
  parent: Ownable | undefined,
  viewerId: string,
  canOpen: (userId: string, projectId: string) => boolean,
): boolean {
  if (item.assigneeIds.includes(viewerId)) return true;
  if (item.assigneeIds.length > 0) return false;
  if (parent) return isYours(parent, undefined, viewerId, canOpen);
  return !item.createdBy || item.createdBy === viewerId || !canOpen(item.createdBy, item.projectId);
}

/**
 * Whether `item` passes the person, label and due filters (not the finished
 * ones, which each view applies where finished items show). A sub-item is
 * part of its parent's task: with no date of its own it's due when its
 * parent is, and with no labels of its own it takes its parent's. An item
 * matches when it has any of the labels picked.
 * `today` is null until the browser knows it; any due filter then matches
 * nothing, rather than showing items it's about to hide.
 */
export function matchesFilters(
  item: Due & { assigneeIds: string[]; labels: string[] },
  parent: (Due & { labels: string[] }) | undefined,
  f: ItemFilters,
  today: string | null,
): boolean {
  const ids = item.assigneeIds;
  const byPerson = f.assignees.length > 0 || f.unassigned;
  if (byPerson && !(f.unassigned && ids.length === 0) && !ids.some((id) => f.assignees.includes(id))) {
    return false;
  }
  const labels = item.labels.length > 0 || !parent ? item.labels : parent.labels;
  if (
    (f.labels.length > 0 || f.unlabelled) &&
    !(f.unlabelled && labels.length === 0) &&
    !labels.some((l) => f.labels.includes(l))
  ) {
    return false;
  }
  return matchesDue(item.dueDate || !parent ? item : parent, f, today);
}

/**
 * The ids to show from top-level items and their checklists: every sub-item
 * that matches, and every parent that matches or has a sub-item that does, so
 * a sub-item always shows under its own parent (and drags within the list
 * it's really in).
 */
export function shownInGroups<T extends { id: string }>(
  groups: Array<T & { children: T[] }>,
  matches: (item: T, parent?: T) => boolean,
): Set<string> {
  const shown = new Set<string>();
  for (const { children, ...g } of groups) {
    const parent = g as unknown as T;
    let any = false;
    for (const child of children) {
      if (!matches(child, parent)) continue;
      shown.add(child.id);
      any = true;
    }
    if (any || matches(parent)) shown.add(parent.id);
  }
  return shown;
}
