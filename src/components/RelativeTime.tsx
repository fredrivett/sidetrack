"use client";

import { useSyncExternalStore } from "react";
import { formatRelative } from "@/lib/time";

const noSubscribe = () => () => {};

/**
 * A time as "3d ago", with the full local date on hover. Relative text renders
 * the same on the server as in the browser; the full date depends on the
 * viewer's timezone, so the title is only added once in the browser.
 */
export function RelativeTime({ ts }: { ts: number | null }) {
  const inBrowser = useSyncExternalStore(noSubscribe, () => true, () => false);
  if (ts === null) return "never";
  const date = new Date(ts);
  return (
    <time dateTime={date.toISOString()} title={inBrowser ? date.toLocaleString() : undefined}>
      {formatRelative(ts)}
    </time>
  );
}
