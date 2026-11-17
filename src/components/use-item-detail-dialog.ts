"use client";

import { useState } from "react";
import type { Item } from "@/core/schema";

/**
 * Open-state for the item detail dialog, lifted above the list/done split so
 * it survives an item moving between them (reopened from Done, or the day
 * turning over) — the row that triggered the dialog unmounts, but this state
 * does not.
 *
 * `item` is looked up live by id against the current `items`, so edits and
 * complete-toggles show in the open dialog immediately. `closingItem` keeps the
 * snapshot captured when the row was clicked, so the dialog can animate out
 * once the live item is gone (closed or deleted) instead of vanishing on
 * unmount. The snapshot is set in the open handler — not derived in render or
 * an effect — to stay clear of the no-ref-in-render / no-setState-in-effect
 * lint rules.
 */
export function useItemDetailDialog(items: Item[], initialItemId: string | null = null) {
  // Only an item on the board: one hidden now (archived, say) mustn't pop
  // open later when a view shows it.
  const [closingItem, setClosingItem] = useState<Item | null>(
    () => items.find((i) => i.id === initialItemId) ?? null,
  );
  const [openItemId, setOpenItemId] = useState(closingItem?.id ?? null);
  const openItem = openItemId
    ? (items.find((i) => i.id === openItemId) ?? null)
    : null;

  return {
    item: openItem ?? closingItem,
    open: openItem !== null,
    openDetail(item: Item) {
      setClosingItem(item);
      setOpenItemId(item.id);
    },
    onOpenChange(next: boolean) {
      if (!next) setOpenItemId(null);
    },
  };
}
