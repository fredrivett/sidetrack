"use client";

import { useSyncExternalStore } from "react";
import { nextDayStart, startOfDay } from "@/lib/time";

function subscribe(onChange: () => void) {
  let timer: ReturnType<typeof setTimeout>;
  const schedule = () => {
    timer = setTimeout(
      () => {
        onChange();
        schedule();
      },
      nextDayStart(Date.now()) - Date.now() + 1000,
    );
  };
  schedule();
  // Timers stall while a laptop or phone sleeps; re-check when the tab returns.
  document.addEventListener("visibilitychange", onChange);
  return () => {
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", onChange);
  };
}

/**
 * Start of the viewer's current day (DAY_START_HOUR, local time), updating
 * when the day turns over while the page is open.
 *
 * The server can't know the viewer's timezone, so the server render and
 * hydration use Infinity — every completed item counts as before today and
 * sits in the collapsed Done section — and the browser's real value takes over
 * straight after. That way the first paint never shows a long run of old
 * crossed-out items that then collapses.
 */
export function useDayStart(): number {
  return useSyncExternalStore(
    subscribe,
    () => startOfDay(Date.now()),
    () => Infinity,
  );
}
