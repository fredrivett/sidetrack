"use client";

import { useState } from "react";
import type { Item } from "@/core/schema";

/**
 * Open-state for the item detail sheet, lifted above the active/completed
 * split so it survives an item moving between lists when it's (un)completed —
 * the row that triggered the sheet unmounts, but this state does not.
 *
 * `item` is looked up live by id against the current `items`, so edits and
 * complete-toggles show in the open sheet immediately. `closingItem` keeps the
 * snapshot captured when the row was clicked, so the sheet can animate out
 * once the live item is gone (closed or deleted) instead of vanishing on
 * unmount. The snapshot is set in the open handler — not derived in render or
 * an effect — to stay clear of the no-ref-in-render / no-setState-in-effect
 * lint rules.
 */
export function useItemDetailSheet(items: Item[]) {
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [closingItem, setClosingItem] = useState<Item | null>(null);
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
