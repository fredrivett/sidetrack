"use client";

import { useState } from "react";
import { sameContent } from "@/lib/same-content";

/**
 * `value`, or the one it had before when it holds the same thing. Each
 * refresh sends the board's data again as new objects; a context that kept
 * passing those on would re-render every row that reads it, though nothing
 * changed.
 */
export function useSameContent<T>(value: T, depth = 4): T {
  const [kept, setKept] = useState(value);
  const same = sameContent(kept, value, depth);
  if (!same) setKept(value);
  return same ? kept : value;
}
