"use client";

import { createContext, useContext } from "react";
import {
  setNoDateCollapsedAction,
  setNoDateListFoldedAction,
  setOverdueCollapsedAction,
} from "@/app/actions";

/**
 * Where the Brief (AgendaView) saves which of its sections are folded away.
 * The board saves them to the viewer's account; the landing page's preview
 * provides local versions, as it does for ItemSavesContext, so nothing leaves
 * the browser.
 */
export interface AgendaSaves {
  setOverdueCollapsed: (collapsed: boolean) => Promise<unknown>;
  setNoDateCollapsed: (collapsed: boolean) => Promise<unknown>;
  setNoDateListFolded: (projectId: string, folded: boolean) => Promise<unknown>;
}

// Each action is looked up when it's called, as in ItemSavesContext.
export const AgendaSavesContext = createContext<AgendaSaves>({
  setOverdueCollapsed: (collapsed) => setOverdueCollapsedAction(collapsed),
  setNoDateCollapsed: (collapsed) => setNoDateCollapsedAction(collapsed),
  setNoDateListFolded: (projectId, folded) => setNoDateListFoldedAction(projectId, folded),
});
export const useAgendaSaves = () => useContext(AgendaSavesContext);
