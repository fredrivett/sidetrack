"use client";

import { createContext, useContext } from "react";
import {
  reorderItemAction,
  setItemParentAction,
  setItemsCollapsedAction,
  startAgentAction,
  stopAgentAction,
  updateItemAction,
} from "@/app/actions";

/**
 * Where the item rows and lists save the changes they make themselves:
 * assigning people and agents, due dates, dragging, and folding a checklist. (Ticking, deleting
 * and nesting from a menu go through ItemChangesContext.) The board saves to
 * the server; the landing page's preview board provides local versions, so a
 * visitor can try the real rows and nothing leaves the browser.
 */
export interface ItemSaves {
  updateItem: (id: string, patch: Parameters<typeof updateItemAction>[1]) => Promise<unknown>;
  reorderItem: (id: string, position: string) => Promise<unknown>;
  setItemParent: (id: string, parentId: string | null, position?: string) => Promise<unknown>;
  setItemsCollapsed: (ids: string[], collapsed: boolean) => Promise<unknown>;
  startAgent: (itemId: string, keyId: string) => Promise<unknown>;
  stopAgent: (itemId: string, keyId: string) => Promise<unknown>;
}

// Each action is looked up when it's called, not when this loads, so a test
// that mocks only the actions it uses can still render the rows.
export const ItemSavesContext = createContext<ItemSaves>({
  updateItem: (id, patch) => updateItemAction(id, patch),
  reorderItem: (id, position) => reorderItemAction(id, position),
  setItemParent: (id, parentId, position) => setItemParentAction(id, parentId, position),
  setItemsCollapsed: (ids, collapsed) => setItemsCollapsedAction(ids, collapsed),
  startAgent: (itemId, keyId) => startAgentAction(itemId, keyId),
  stopAgent: (itemId, keyId) => stopAgentAction(itemId, keyId),
});
export const useItemSaves = () => useContext(ItemSavesContext);
