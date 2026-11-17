"use client";

import {
  createContext,
  createElement,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { dayOf, nextDayStart, startOfDay } from "@/lib/time";

// One timer and one visibility listener for every component on the page
// (each due badge reads the day), fanned out to subscribers.
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;

function notify() {
  for (const l of listeners) l();
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(
    () => {
      notify();
      schedule();
    },
    nextDayStart(Date.now()) - Date.now() + 1000,
  );
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  if (listeners.size === 1) {
    schedule();
    // Timers stall while a laptop or phone sleeps; re-check when the tab returns.
    document.addEventListener("visibilitychange", notify);
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", notify);
    }
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

/**
 * The viewer's current day as "YYYY-MM-DD" (4am turnover, local time), or
 * null during the server render and hydration, where it isn't known.
 */
export function useToday(): string | null {
  const start = useDayStart();
  return Number.isFinite(start) ? dayOf(start) : null;
}

type Guess = { today: string | null; dayStart: number | null; locale: string | null };

const ServerGuess = createContext<Guess>({ today: null, dayStart: null, locale: null });

/**
 * Gives the server's guess at the viewer's day, its start, and their locale
 * to useLabelDay and useListDayStart.
 */
export function ServerTodayProvider({
  today,
  dayStart,
  locale,
  children,
}: Guess & { children: ReactNode }) {
  return createElement(ServerGuess.Provider, { value: { today, dayStart, locale } }, children);
}

/**
 * Where a list splits today's finished items (kept in the list) from earlier
 * ones (in Done). Like useLabelDay, the server's guess (the day start in the
 * timezone the viewer last saved) stands in until the browser knows its own,
 * so an item finished today doesn't render in Done and then jump into the
 * list on hydration. Infinity when there's no guess either (see useDayStart).
 */
export function useListDayStart(): number {
  const dayStart = useDayStart();
  const guess = useContext(ServerGuess).dayStart;
  return Number.isFinite(dayStart) ? dayStart : (guess ?? Infinity);
}

/**
 * The day and locale to write due labels in. Once the browser knows its day,
 * that day and its own locale (undefined). Before then (server render and
 * hydration), the server's guess: the day in the timezone the viewer last
 * saved and the locale their browser last saved (LOCALE_COOKIE), each null
 * when it hasn't saved one. Both render the same on the server and in the
 * browser, so labels don't change as the page loads. The guessed day can be
 * a day out after the viewer travels, until the browser corrects it.
 */
export function useLabelDay(): { today: string | null; locale: string | null | undefined } {
  const today = useToday();
  const guess = useContext(ServerGuess);
  return today ? { today, locale: undefined } : guess;
}
