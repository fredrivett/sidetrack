"use client";

import {
  createContext,
  createElement,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { dayOf, nextDayStart, startOfDay, startOfWeek } from "@/lib/time";

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
  return Number.isFinite(start) ? dayOfStart(start) : null;
}

// Every row asks, all with the same start, so work each day out once (one
// entry a day the page stays open).
const days = new Map<number, string>();
function dayOfStart(start: number): string {
  let day = days.get(start);
  if (day === undefined) days.set(start, (day = dayOf(start)));
  return day;
}

type Guess = {
  today: string | null;
  dayStart: number | null;
  weekStart: number | null;
  locale: string | null;
};

const ServerGuess = createContext<Guess>({
  today: null,
  dayStart: null,
  weekStart: null,
  locale: null,
});

/**
 * Gives the server's guess at the viewer's day, when it and its week began,
 * and their locale to useLabelDay and useListBounds.
 */
export function ServerTodayProvider({
  today,
  dayStart,
  weekStart,
  locale,
  children,
}: Guess & { children: ReactNode }) {
  return createElement(
    ServerGuess.Provider,
    { value: { today, dayStart, weekStart, locale } },
    children,
  );
}

/**
 * Where a list splits its finished items: from dayStart they stay in the
 * list, from weekStart they go to Done, and earlier ones leave the board.
 * Like useLabelDay, the server's guess (in the timezone the viewer last saved)
 * stands in until the browser knows its own day, so rows don't move between
 * the list and Done, or Done appear and vanish, on hydration. With no guess
 * either, every finished item counts as earlier in the week (see useDayStart).
 */
export function useListBounds(): { dayStart: number; weekStart: number } {
  const dayStart = useDayStart();
  const guess = useContext(ServerGuess);
  if (Number.isFinite(dayStart)) return { dayStart, weekStart: startOfWeek(dayStart) };
  return { dayStart: guess.dayStart ?? Infinity, weekStart: guess.weekStart ?? -Infinity };
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
