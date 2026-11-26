"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  addParentItemAction,
  cancelItemAction,
  completeItemAction,
  deleteItemAction,
  setItemParentAction,
  uncompleteItemAction,
} from "@/app/actions";
import type { Saved } from "@/core/items";
import type { Item } from "@/core/schema";
import { runAction } from "./run-action";

/**
 * The item changes the board shows ahead of the server (see AGENTS.md, "Saving
 * changes"): ticking, deleting, and nesting or moving out from a menu. Every
 * place that makes one of these changes goes through here, so it looks the
 * same from the row, the dialog, a shortcut or the palette.
 */
export interface ItemChanges {
  setCompleted: (item: Item, done: boolean) => void;
  deleteItem: (item: Item) => void;
  setParent: (item: Item, parentId: string | null) => void;
  /**
   * Held, not shown ahead: the server checks the replacement, so whatever
   * asks (the cancel dialog) waits on it, dimmed, and closes once it lands.
   */
  cancel: (item: Item, opts: CancelOpts) => Promise<boolean>;
  /**
   * Held too: a new item in this one's place, holding it as its first
   * sub-item. The server gives the new item its ref, so whatever asks (the
   * new parent dialog) waits on it. The new parent, or null if it failed.
   */
  addParent: (item: Item, title: string) => Promise<Item | null>;
}

/** `replacedBy`: the ref typed, such as "SDT-87". */
export type CancelOpts = { reason?: string | null; replacedBy?: string | null };

export type ItemChange =
  | { kind: "complete"; item: Item; done: boolean; at: number }
  | { kind: "delete"; item: Item }
  | { kind: "parent"; item: Item; parentId: string | null };

/** Each saves, then hands what it returns to `merge` (useSavedItems). */
const saves = (merge: (saved: unknown) => void) => ({
  complete: (item: Item, done: boolean) =>
    runAction(
      (done ? completeItemAction(item.id) : uncompleteItemAction(item.id)).then(merge),
      `${done ? "complete" : "reopen"} “${item.title}”`,
    ),
  cancel: (item: Item, opts: CancelOpts) =>
    runAction(cancelItemAction(item.id, opts).then(merge), `cancel “${item.title}”`),
  addParent: async (item: Item, title: string) => {
    let parent: Item | null = null;
    await runAction(
      addParentItemAction(item.id, title).then((saved) => {
        merge(saved);
        parent = saved.parent;
      }),
      `add a parent for “${item.title}”`,
    );
    return parent;
  },
  delete: (item: Item) => runAction(deleteItemAction(item.id).then(merge), `delete “${item.title}”`),
  parent: (item: Item, parentId: string | null) =>
    runAction(setItemParentAction(item.id, parentId).then(merge), `move “${item.title}”`),
});

/**
 * Outside the board, which holds no items of its own, a change shows once
 * the page next reloads.
 */
const unheld = saves(() => {});
export const ItemChangesContext = createContext<ItemChanges>({
  setCompleted: (item, done) => void unheld.complete(item, done),
  deleteItem: (item) => void unheld.delete(item),
  setParent: (item, parentId) => void unheld.parent(item, parentId),
  cancel: (item, opts) => unheld.cancel(item, opts),
  addParent: (item, title) => unheld.addParent(item, title),
});
export const useItemChanges = () => useContext(ItemChangesContext);

/**
 * The same change completeItem / uncompleteItem make on the server
 * (src/core/items.ts): completing a parent ticks its open sub-items, ticking a
 * parent's last open sub-item completes the parent, and reopening a sub-item
 * reopens its finished parent.
 */
/** What reopening sets, as uncompleteItem does: open, and no longer cancelled. */
const reopened = { completedAt: null, cancelled: false, cancelReason: null, replacedById: null };

function complete(list: Item[], item: Item, done: boolean, at: number): Item[] {
  const closesParent =
    done &&
    item.parentId !== null &&
    list.every((i) => i.parentId !== item.parentId || i.id === item.id || i.completedAt !== null);
  return list.map((i) => {
    if (i.id === item.id) return done ? { ...i, completedAt: at } : { ...i, ...reopened };
    if (closesParent && i.id === item.parentId && i.completedAt === null) {
      return { ...i, completedAt: at };
    }
    if (done && i.parentId === item.id && i.completedAt === null) {
      return { ...i, completedAt: at };
    }
    if (!done && i.id === item.parentId && i.completedAt !== null) {
      return { ...i, ...reopened };
    }
    return i;
  });
}

/**
 * The same move setItemParent makes without a position: nesting puts the item
 * last among the parent's sub-items, and moving out puts it straight after its
 * old parent. Nesting an open item reopens a finished parent. A list is sorted
 * by position across both levels, so sub-items and top-level items interleave
 * in it; the board groups them (nestItems), where only each level's own order
 * counts.
 */
function reparent(list: Item[], item: Item, parentId: string | null): Item[] {
  const current = list.find((i) => i.id === item.id);
  if (!current || current.parentId === parentId) return list;
  const reopens = parentId !== null && current.completedAt === null;
  const rest = list
    .filter((i) => i.id !== item.id)
    .map((i) =>
      reopens && i.id === parentId && i.completedAt !== null ? { ...i, completedAt: null } : i,
    );
  // Nesting: after the parent's last sub-item (or the parent itself).
  // Moving out: right after the old parent, ahead of the next top-level item.
  const after = parentId
    ? rest.findLastIndex((i) => i.id === parentId || i.parentId === parentId)
    : rest.findIndex((i) => i.id === current.parentId);
  const at = after === -1 ? rest.length : after + 1;
  return [...rest.slice(0, at), { ...current, parentId }, ...rest.slice(at)];
}

/** One change applied to a flat list of items (one list's, or any mix). */
export function applyItemChange(list: Item[], change: ItemChange): Item[] {
  return change.kind === "complete"
    ? // The item as it is now in `list`: an earlier change may have moved it.
      complete(list, list.find((i) => i.id === change.item.id) ?? change.item, change.done, change.at)
    : change.kind === "delete"
      ? // Deleting a parent deletes its sub-items with it, as on the server.
        list.filter((i) => i.id !== change.item.id && i.parentId !== change.item.id)
      : reparent(list, change.item, change.parentId);
}

function applyChange(
  byProject: Record<string, Item[]>,
  change: ItemChange,
): Record<string, Item[]> {
  const { projectId } = change.item;
  const list = byProject[projectId];
  if (!list) return byProject;
  return { ...byProject, [projectId]: applyItemChange(list, change) };
}

/** Rows saves and live updates handed back, by id: null once gone. */
type Rows = Map<string, { row: Item | null; asOf: number }>;

/** Whether an action's result is rows to put in, not a save that refreshed instead. */
export function isSaved(value: unknown): value is Saved {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Saved).seq === "number" &&
    Array.isArray((value as Saved).items) &&
    Array.isArray((value as Saved).gone)
  );
}

/** `list` with the saved rows in place of its own, and without the gone ones: for a copy of some items, like the Done view's older pages. */
export function applySaved(list: Item[], saved: Saved): Item[] {
  const rows = new Map(saved.items.map((i) => [i.id, i]));
  const gone = new Set(saved.gone);
  // The same list when none of the rows are in it.
  if (!list.some((i) => rows.has(i.id) || gone.has(i.id))) return list;
  return list.flatMap((i) => (gone.has(i.id) ? [] : [rows.get(i.id) ?? i]));
}

/** The server's order, `orderBy(position, id)`: code units, not the locale's. */
function before(a: Item, b: Item) {
  return a.position < b.position || (a.position === b.position && a.id < b.id);
}

/**
 * `byProject` with the rows read after it was rendered (change number
 * `seq`) in place of its own. A row stays where it is unless it moved, or
 * came back from the Done view's older items (which sit after the board's,
 * out of position order); then it, like a new row, goes before the first
 * row it sorts ahead of, which keeps the rest's order. A row not there
 * already joins only as the server would show it: with its checklist, while
 * any of that is open or done since `since` (listItems' completedSince).
 */
function overlay(byProject: Record<string, Item[]>, seq: number, rows: Rows, since: number) {
  const newer = new Map([...rows].filter(([, r]) => r.asOf > seq));
  if (newer.size === 0) return byProject;
  const old = (i: Item) => i.completedAt !== null && i.completedAt < since;
  const out = { ...byProject };
  const placed = new Set<string>();
  for (const [projectId, list] of Object.entries(byProject)) {
    if (!list.some((i) => newer.has(i.id))) continue;
    out[projectId] = list.flatMap((i) => {
      const row = newer.get(i.id)?.row;
      if (row === undefined) return [i];
      if (
        row === null ||
        row.projectId !== projectId ||
        row.position !== i.position ||
        old(row) !== old(i)
      ) {
        return [];
      }
      placed.add(i.id);
      return [row];
    });
  }
  const shown = new Set<string>();
  for (const list of Object.values(out)) for (const i of list) if (!old(i)) shown.add(i.parentId ?? i.id);
  for (const { row } of newer.values()) if (row && !old(row)) shown.add(row.parentId ?? row.id);
  for (const [id, { row }] of newer) {
    if (!row || placed.has(id) || !out[row.projectId] || !shown.has(row.parentId ?? row.id)) continue;
    const list = (out[row.projectId] = [...out[row.projectId]]);
    const at = list.findIndex((i) => before(row, i));
    list.splice(at === -1 ? list.length : at, 0, row);
  }
  return out;
}

/** `next`, with each list that holds the same items as in `prev` kept as `prev`'s array; `prev` when all are. */
function sameLists(prev: Record<string, Item[]>, next: Record<string, Item[]>) {
  let changed = Object.keys(prev).length !== Object.keys(next).length;
  const out: Record<string, Item[]> = {};
  for (const [id, list] of Object.entries(next)) {
    const had = prev[id];
    const same = had !== undefined && had.length === list.length && had.every((i, n) => i === list[n]);
    out[id] = same ? had : list;
    if (!same) changed = true;
  }
  return changed ? out : prev;
}

/**
 * `itemsByProject` with the rows that saves and live updates have handed
 * back since the server rendered it (as of change number `seq`), so a save
 * needn't reload the whole board: an item save returns its rows (`Saved`)
 * and `merge` puts them in. Each row is kept until the server renders one at
 * least as new, and a row only replaces one as old or older, so saves, live
 * updates and refreshes can land in any order. Likewise the items a save
 * says the viewer now follows (`followed`).
 *
 * Call `merge` before the transition that showed the change ahead ends, as
 * the saves here do, so the change is never shown undone in between.
 * Anything that isn't `Saved`, like a save that still refreshes, is ignored.
 *
 * `asOf` and `own` tell LiveUpdates which events the board has shown
 * already: those about rows it holds as new, and those of its own saves.
 */
export function useSavedItems(
  itemsByProject: Record<string, Item[]>,
  seq: number,
  /** The board's done items go back this far (listItems' completedSince). */
  completedSince: number,
) {
  const [rows, setRows] = useState<Rows>(() => new Map());
  const [follows, setFollows] = useState<ReadonlyMap<string, number>>(() => new Map());
  const rendered = useRef(seq);
  const held = useRef(rows);
  /** Each save's changes, as (from, to]: those after `from`, up to `to`. */
  const ownSaves = useRef<[number, number][]>([]);
  useEffect(() => {
    rendered.current = seq;
    held.current = rows;
  }, [seq, rows]);
  const merge = useCallback((saved: unknown) => {
    if (!isSaved(saved)) return;
    // Drop what the server has rendered since.
    const fresh = <T>(had: Iterable<[string, T]>, asOf: (t: T) => number) =>
      new Map([...had].filter(([, t]) => asOf(t) > rendered.current));
    setRows((had) => {
      const next: Rows = fresh(had, (r) => r.asOf);
      const put = (id: string, row: Item | null) => {
        if ((next.get(id)?.asOf ?? -Infinity) <= saved.seq) next.set(id, { row, asOf: saved.seq });
      };
      for (const row of saved.items) put(row.id, row);
      for (const id of saved.gone) put(id, null);
      return next;
    });
    if (saved.followed?.length) {
      const followed = saved.followed;
      setFollows((had) => {
        const next = fresh(had, (asOf) => asOf);
        for (const id of followed) next.set(id, Math.max(next.get(id) ?? -Infinity, saved.seq));
        return next;
      });
    }
    const { from } = saved;
    if (from !== undefined) {
      ownSaves.current = [...ownSaves.current.filter(([, to]) => to > rendered.current), [from, saved.seq]];
    }
  }, []);
  // Each list keeps its array while it holds the same rows: a list with a
  // row saved earlier would otherwise get a new one on every save anywhere,
  // and re-render (ProjectColumn is memoized on its items).
  const [kept, setKept] = useState(itemsByProject);
  const built = useMemo(
    () => overlay(itemsByProject, seq, rows, completedSince),
    [itemsByProject, seq, rows, completedSince],
  );
  const items = useMemo(() => sameLists(kept, built), [kept, built]);
  if (items !== kept) setKept(items);
  const followed = useMemo(
    () => [...follows].flatMap(([id, asOf]) => (asOf > seq ? [id] : [])),
    [follows, seq],
  );
  /** The change number the board's copy of `id` is as of: the page's, or a newer row's. */
  const asOf = useCallback(
    (id: string) => Math.max(rendered.current, held.current.get(id)?.asOf ?? -Infinity),
    [],
  );
  /** Whether changes `first` to `last` were all made by this board's own saves. */
  const own = useCallback(
    (first: number, last: number) => ownSaves.current.some(([from, to]) => first > from && last <= to),
    [],
  );
  return { items, merge, followed, asOf, own };
}

/**
 * The board's items with these changes shown ahead of the server: a change
 * shows the moment it's made, everywhere the item appears (its row, a parent's
 * progress, an open dialog), and is held until the saved rows replace it
 * (`merge`, from useSavedItems). If saving fails, the transition ends
 * without them, so the change undoes itself and a toast says so.
 */
export function useOptimisticItems(
  itemsByProject: Record<string, Item[]>,
  merge: (saved: unknown) => void,
) {
  const [optimistic, apply] = useOptimistic(itemsByProject, applyChange);
  // Its own transition, so a change shown ahead doesn't also dim or disable
  // the row the way the row's held saves do.
  const [, start] = useTransition();
  const changes = useMemo<ItemChanges>(() => {
    const save = saves(merge);
    const run = (change: ItemChange, saved: () => Promise<boolean>) =>
      start(async () => {
        apply(change);
        await saved();
      });
    return {
      setCompleted: (item, done) =>
        run({ kind: "complete", item, done, at: Date.now() }, () => save.complete(item, done)),
      deleteItem: (item) => run({ kind: "delete", item }, () => save.delete(item)),
      setParent: (item, parentId) =>
        run({ kind: "parent", item, parentId }, () => save.parent(item, parentId)),
      cancel: (item, opts) => save.cancel(item, opts),
      addParent: (item, title) => save.addParent(item, title),
    };
  }, [apply, merge]);
  return [optimistic, changes] as const;
}
