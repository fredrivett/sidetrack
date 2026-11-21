"use client";

import { useOptimistic, useTransition } from "react";
import type { Item } from "@/core/schema";
import { useItemSaves } from "./item-saves";
import { runAction } from "./run-action";

/**
 * The parents among `items` whose sub-items are hidden: `item.collapsed`, with
 * the viewer's toggles shown at once rather than after the save and refresh.
 * Once a toggle lands, the saved rows (useSavedItems) take over again.
 */
export function useCollapsedItems(items: Item[]) {
  const [collapsed, apply] = useOptimistic(
    new Set(items.filter((i) => i.collapsed).map((i) => i.id)) as ReadonlySet<string>,
    (s, [ids, value]: [string[], boolean]) => {
      const next = new Set(s);
      for (const id of ids) {
        if (value) next.add(id);
        else next.delete(id);
      }
      return next;
    },
  );
  const [, start] = useTransition();
  const { setItemsCollapsed } = useItemSaves();
  const setCollapsed = (ids: string[], value: boolean) =>
    start(async () => {
      apply([ids, value]);
      await runAction(
        setItemsCollapsed(ids, value),
        value ? "collapse sub-items" : "expand sub-items",
      );
    });
  return { collapsed, setCollapsed };
}
