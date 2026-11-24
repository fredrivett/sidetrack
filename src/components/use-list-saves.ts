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
 * A list dragged to a new place on the board: before or after another list
 * (`ref`, null to leave its place), and into another Space's tray when
 * `spaceId` is set (null for none).
 */
export type ListMove = { id: string; ref: string | null; spaceId?: string | null };

type ListChange = { remove: string } | { move: ListMove };

function applyChange<P extends { id: string; spaceId: string | null }>(cur: P[], change: ListChange) {
  return "remove" in change ? cur.filter((p) => p.id !== change.remove) : moveInLists(cur, change.move);
}

/** The lists with `move` made: the board's order, as dragging shows it. */
export function moveInLists<P extends { id: string; spaceId: string | null }>(cur: P[], move: ListMove) {
  const { id, ref, spaceId } = move;
  const moved = cur.find((p) => p.id === id);
  if (!moved) return cur;
  const next = spaceId === undefined ? moved : { ...moved, spaceId };
  const rest = cur.filter((p) => p.id !== id);
  const [side, anchor] = ref?.split(":") ?? [];
  const at = rest.findIndex((p) => p.id === anchor);
  if (at === -1) return cur.map((p) => (p.id === id ? next : p));
  const to = side === "after" ? at + 1 : at;
  return [...rest.slice(0, to), next, ...rest.slice(to)];
}

/**
 * The board's lists with removals and drags shown ahead of the server. If
 * the save fails, the transition ends without them, so the list comes back
 * and a toast says so. A dragged list is held, dimmed (`moving`), in its new
 * place until its save lands.
 */
export function useOptimisticLists<P extends { id: string; spaceId: string | null }>(lists: P[]) {
  const [optimistic, change] = useOptimistic(lists, applyChange<P>);
  const [moving, markMoving] = useOptimistic([] as string[], (cur, id: string) => [...cur, id]);
  const [, start] = useTransition();
  const removeList = useMemo(
    () => (removal: Removal) =>
      start(async () => {
        change({ remove: removal.id });
        await remove(removal);
      }),
    [change],
  );
  // Returns the save, for a dialog that holds until it lands.
  const moveList = useMemo(
    () => (move: ListMove, save: () => Promise<unknown>) => {
      let done!: Promise<unknown>;
      // start runs the callback at once, so `done` is set before it returns.
      start(async () => {
        change({ move });
        markMoving(move.id);
        done = save();
        await done;
      });
      return done;
    },
    [change, markMoving],
  );
  return { lists: optimistic, removeList, moveList, moving } as const;
}

/**
 * A list's held saves: its status, order, prefix, icon, homepage and sorting.
 * The column provides one, and dims while any of them is saving, so a save
 * shows on the list itself rather than only on the menu or badge that started
 * it, which may have closed.
 */
export interface ListSave {
  saving: boolean;
  /** Runs `work` as a held save; returns its promise, for callers that wait. */
  save: <T>(work: () => Promise<T>) => Promise<T>;
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
      save: <T,>(work: () => Promise<T>) => {
        let done!: Promise<T>;
        // start runs the callback at once, so `done` is set before it returns.
        start(async () => {
          // A throw from work() rejects `done` rather than leaving it unset.
          done = new Promise<T>((resolve) => resolve(work()));
          await done;
        });
        return done;
      },
    }),
    [saving],
  );
}
