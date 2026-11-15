"use client";

import { useCallback, useOptimistic, useTransition } from "react";
import { updateItemAction } from "@/app/actions";
import type { Item } from "@/core/schema";

/**
 * Items' assignees as the viewer last set them, ahead of the server. Every
 * way of changing assignees (ticks in the picker, the I shortcut) reads and
 * writes this one copy, so a change made before the last one has come back
 * builds on it instead of on the stale server set and dropping someone.
 * Once a change lands, the refreshed items take over again.
 *
 * The server gets who was added and who was taken off, not the whole set, so
 * a change made from another screen's copy (a row and a dialog, or two
 * people's phones) is kept rather than overwritten. Unassigned is the one
 * absolute change: it clears everyone.
 */
export function useOptimisticAssignees(items: Item[]) {
  const [byId, apply] = useOptimistic(
    Object.fromEntries(items.map((i) => [i.id, i.assigneeIds])),
    (state: Record<string, string[]>, [id, ids]: [string, string[]]) => ({
      ...state,
      [id]: ids,
    }),
  );
  // Its own transition, so a pending assignment doesn't dim or disable the
  // rest of the item the way the caller's other pending changes do.
  const [, start] = useTransition();
  const setAssignees = useCallback(
    (id: string, assigneeIds: string[]) => {
      const current = byId[id] ?? [];
      const add = assigneeIds.filter((a) => !current.includes(a));
      const remove = current.filter((a) => !assigneeIds.includes(a));
      start(async () => {
        apply([id, assigneeIds]);
        await updateItemAction(
          id,
          assigneeIds.length === 0
            ? { assigneeIds: [] }
            : {
                ...(add.length ? { addAssigneeIds: add } : {}),
                ...(remove.length ? { removeAssigneeIds: remove } : {}),
              },
        );
      });
    },
    [apply, byId],
  );
  return { assigneesById: byId, setAssignees };
}
