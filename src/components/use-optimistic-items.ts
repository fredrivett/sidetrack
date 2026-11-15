"use client";

import {
  createContext,
  useContext,
  useMemo,
  useOptimistic,
  useTransition,
} from "react";
import {
  completeItemAction,
  deleteItemAction,
  setItemParentAction,
  uncompleteItemAction,
} from "@/app/actions";
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
}

type Change =
  | { kind: "complete"; item: Item; done: boolean; at: number }
  | { kind: "delete"; item: Item }
  | { kind: "parent"; item: Item; parentId: string | null };

const saves = {
  complete: (item: Item, done: boolean) =>
    runAction(
      done ? completeItemAction(item.id) : uncompleteItemAction(item.id),
      `${done ? "complete" : "reopen"} “${item.title}”`,
    ),
  delete: (item: Item) => runAction(deleteItemAction(item.id), `delete “${item.title}”`),
  parent: (item: Item, parentId: string | null) =>
    runAction(setItemParentAction(item.id, parentId), `move “${item.title}”`),
};

/**
 * Outside the board, a change shows once the server's refresh lands.
 */
export const ItemChangesContext = createContext<ItemChanges>({
  setCompleted: (item, done) => void saves.complete(item, done),
  deleteItem: (item) => void saves.delete(item),
  setParent: (item, parentId) => void saves.parent(item, parentId),
});
export const useItemChanges = () => useContext(ItemChangesContext);

/**
 * The same change completeItem / uncompleteItem make on the server
 * (src/core/items.ts): completing a parent ticks its open sub-items, ticking a
 * parent's last open sub-item completes the parent, and reopening a sub-item
 * reopens its finished parent.
 */
function complete(list: Item[], item: Item, done: boolean, at: number): Item[] {
  const closesParent =
    done &&
    item.parentId !== null &&
    list.every((i) => i.parentId !== item.parentId || i.id === item.id || i.completedAt !== null);
  return list.map((i) => {
    if (i.id === item.id) return { ...i, completedAt: done ? at : null };
    if (closesParent && i.id === item.parentId && i.completedAt === null) {
      return { ...i, completedAt: at };
    }
    if (done && i.parentId === item.id && i.completedAt === null) {
      return { ...i, completedAt: at };
    }
    if (!done && i.id === item.parentId && i.completedAt !== null) {
      return { ...i, completedAt: null };
    }
    return i;
  });
}

/**
 * The same move setItemParent makes without a position: nesting puts the item
 * last among the parent's sub-items, and moving out puts it straight after its
 * old parent. Lists are in position order, so it moves in the array: after the
 * last row of that parent's group.
 */
function reparent(list: Item[], item: Item, parentId: string | null): Item[] {
  const current = list.find((i) => i.id === item.id);
  if (!current || current.parentId === parentId) return list;
  const group = parentId ?? current.parentId;
  const rest = list.filter((i) => i.id !== item.id);
  let at = rest.length;
  for (let i = rest.length - 1; i >= 0; i--) {
    if (rest[i].id === group || rest[i].parentId === group) {
      at = i + 1;
      break;
    }
  }
  return [...rest.slice(0, at), { ...current, parentId }, ...rest.slice(at)];
}

function applyChange(
  byProject: Record<string, Item[]>,
  change: Change,
): Record<string, Item[]> {
  const { projectId } = change.item;
  const list = byProject[projectId];
  if (!list) return byProject;
  const next =
    change.kind === "complete"
      ? complete(list, change.item, change.done, change.at)
      : change.kind === "delete"
        ? // Deleting a parent deletes its sub-items with it, as on the server.
          list.filter((i) => i.id !== change.item.id && i.parentId !== change.item.id)
        : reparent(list, change.item, change.parentId);
  return { ...byProject, [projectId]: next };
}

/**
 * The board's items with these changes shown ahead of the server: a change
 * shows the moment it's made, everywhere the item appears (its row, a parent's
 * progress, an open dialog), and is held until the refreshed items replace
 * it. If saving fails, the transition ends without them, so the change undoes
 * itself and a toast says so.
 */
export function useOptimisticItems(itemsByProject: Record<string, Item[]>) {
  const [optimistic, apply] = useOptimistic(itemsByProject, applyChange);
  // Its own transition, so a change shown ahead doesn't also dim or disable
  // the row the way the row's held saves do.
  const [, start] = useTransition();
  const changes = useMemo<ItemChanges>(
    () => ({
      setCompleted: (item, done) =>
        start(async () => {
          apply({ kind: "complete", item, done, at: Date.now() });
          await saves.complete(item, done);
        }),
      deleteItem: (item) =>
        start(async () => {
          apply({ kind: "delete", item });
          await saves.delete(item);
        }),
      setParent: (item, parentId) =>
        start(async () => {
          apply({ kind: "parent", item, parentId });
          await saves.parent(item, parentId);
        }),
    }),
    [apply],
  );
  return [optimistic, changes] as const;
}
