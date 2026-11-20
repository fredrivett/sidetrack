"use client";

import { createContext, useContext } from "react";
import type { ListAccess } from "@/core/schema";

/**
 * What the viewer can do on each list, by list id: edit, comment or only
 * view (core/access.ts). The server refuses changes they can't make; this
 * is so the UI doesn't offer them. A list missing from it, as on the
 * landing page's preview board, is editable.
 */
export const ListAccessContext = createContext<Record<string, ListAccess>>({});

export function useListAccess(projectId: string): ListAccess {
  return useContext(ListAccessContext)[projectId] ?? "edit";
}
