"use client";

import {
  createContext,
  useCallback,
  useContext,
  useOptimistic,
  useTransition,
} from "react";
import { completeItemAction, uncompleteItemAction } from "@/app/actions";
import type { Item } from "@/core/schema";
import { runAction } from "./run-action";

type SetCompleted = (item: Item, done: boolean) => void;
type Change = { item: Item; done: boolean; at: number };

const save = (item: Item, done: boolean) =>
  runAction(
    done ? completeItemAction(item.id) : uncompleteItemAction(item.id),
    `${done ? "complete" : "reopen"} “${item.title}”`,
  );

/**
 * Ticks and unticks an item. The board provides one that shows the change at
 * once (see useOptimisticCompletion); outside it, the change shows once the
 * server's refresh lands.
 */
export const CompletionContext = createContext<SetCompleted>((item, done) => {
  void save(item, done);
});
export const useSetCompleted = () => useContext(CompletionContext);

/**
 * The same change completeItem / uncompleteItem make on the server
 * (src/core/items.ts): completing a parent ticks its open sub-items, ticking a
 * parent's last open sub-item completes the parent, and reopening a sub-item
 * reopens its finished parent.
 */
function applyChange(
  byProject: Record<string, Item[]>,
  { item, done, at }: Change,
): Record<string, Item[]> {
  const list = byProject[item.projectId];
  if (!list) return byProject;
  const closesParent =
    done &&
    item.parentId !== null &&
    list.every((i) => i.parentId !== item.parentId || i.id === item.id || i.completedAt !== null);
  return {
    ...byProject,
    [item.projectId]: list.map((i) => {
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
    }),
  };
}

/**
 * The board's items with ticks shown ahead of the server: a tick shows the
 * moment it's made, everywhere the item appears (its row, a parent's
 * progress, an open dialog), and is held until the refreshed items replace
 * it. If saving fails, the transition ends without them, so the tick undoes
 * itself and a toast says so.
 */
export function useOptimisticCompletion(itemsByProject: Record<string, Item[]>) {
  const [optimistic, apply] = useOptimistic(itemsByProject, applyChange);
  // Its own transition, so a pending tick doesn't dim or disable the row the
  // way the row's other pending changes do.
  const [, start] = useTransition();
  const setCompleted = useCallback<SetCompleted>(
    (item, done) => {
      start(async () => {
        apply({ item, done, at: Date.now() });
        await save(item, done);
      });
    },
    [apply],
  );
  return [optimistic, setCompleted] as const;
}
