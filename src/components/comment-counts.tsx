"use client";

import { createContext, type ReactNode, useContext } from "react";

// How many comments each item has, read by each row instead of being passed
// down through every view. Adding or deleting a comment reloads the board, so
// it stays current. Empty outside the board (the landing page's preview).
const CommentCountsContext = createContext<Record<string, number>>({});

export function CommentCountsProvider({
  counts,
  children,
}: {
  counts: Record<string, number>;
  children: ReactNode;
}) {
  return <CommentCountsContext value={counts}>{children}</CommentCountsContext>;
}

export function useCommentCount(itemId: string): number {
  return useContext(CommentCountsContext)[itemId] ?? 0;
}
