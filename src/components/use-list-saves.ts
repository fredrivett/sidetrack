"use client";

import {
  createContext,
  useContext,
  useMemo,
  useOptimistic,
  useTransition,
} from "react";
import { deleteProjectAction, leaveProjectAction } from "@/app/actions";
import { runAction } from "./run-action";

// How the board shows saves to a list (see AGENTS.md, "Saving changes").

type Removal = { id: string; name: string; kind: "delete" | "leave" };

const remove = ({ id, name, kind }: Removal) =>
  runAction(
    kind === "delete" ? deleteProjectAction(id) : leaveProjectAction(id),
    `${kind} “${name}”`,
  );

/**
 * Deleting or leaving a list takes it off the board at once, from its menu
 * or its details alike. Outside the board, it goes once the refresh lands.
 */
export const RemoveListContext = createContext<(removal: Removal) => void>((removal) => {
  void remove(removal);
});
export const useRemoveList = () => useContext(RemoveListContext);

/**
 * The board's lists with removals shown ahead of the server. If the save
 * fails, the transition ends without them, so the list comes back and a
 * toast says so.
 */
export function useOptimisticLists<P extends { id: string }>(lists: P[]) {
  const [optimistic, drop] = useOptimistic(lists, (cur: P[], id: string) =>
    cur.filter((p) => p.id !== id),
  );
  const [, start] = useTransition();
  const removeList = useMemo(
    () => (removal: Removal) =>
      start(async () => {
        drop(removal.id);
        await remove(removal);
      }),
    [drop],
  );
  return [optimistic, removeList] as const;
}

/**
 * A list's held saves: its status, order, prefix, icon, homepage and sorting.
 * The column provides one, and dims while any of them is saving, so a save
 * shows on the list itself rather than only on the menu or badge that started
 * it, which may have closed.
 */
export interface ListSave {
  saving: boolean;
  save: (work: () => Promise<unknown>) => void;
}
export const ListSaveContext = createContext<ListSave | null>(null);

/** Starts a column's list save; outside a column, holds on its own. */
export function useListSave(): ListSave {
  const column = useContext(ListSaveContext);
  const own = useNewListSave();
  return column ?? own;
}

/** A new hold for a column to provide. */
export function useNewListSave(): ListSave {
  const [saving, start] = useTransition();
  return useMemo(
    () => ({
      saving,
      save: (work) =>
        start(async () => {
          await work();
        }),
    }),
    [saving],
  );
}
