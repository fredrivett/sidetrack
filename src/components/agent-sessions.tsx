"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import type { AgentSession } from "@/core/schema";
import type { AgentAvatarView } from "./UserAvatar";

/** An agent with no report for this long shows as idle rather than working. */
const IDLE_AFTER_MS = 15 * 60_000;
const TICK_MS = 60_000;
/** How often the board reloads while an agent is working, and otherwise. */
const POLL_ACTIVE_MS = 60_000;
const POLL_QUIET_MS = 5 * 60_000;

// The board's agent work sessions, by item, read by each row and detail sheet
// (useItemAgentSessions) instead of being passed down through every view.
const SessionsContext = createContext<Record<string, AgentSession[]>>({});
const NO_SESSIONS: AgentSession[] = [];

// One minute clock for every agent on the page, so working turns idle on time.
let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
function tick() {
  now = Date.now();
  for (const l of listeners) l();
}
function subscribe(onChange: () => void) {
  listeners.add(onChange);
  if (listeners.size === 1) {
    tick();
    timer = setInterval(tick, TICK_MS);
    document.addEventListener("visibilitychange", tick);
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    }
  };
}

const noSubscribe = () => () => {};

/**
 * The time, to the minute, or null during the server render and hydration,
 * where every open session counts as working. Only a caller that needs it
 * (`active`) follows the clock, so rows without an agent never re-render.
 */
function useMinuteClock(active: boolean): number | null {
  return useSyncExternalStore(
    active ? subscribe : noSubscribe,
    () => (active ? now : 0),
    () => null,
  );
}

/**
 * Provides the sessions to the rows and dialogs, and keeps them current
 * without real time: the board reloads when the tab comes back into view, and
 * while it's visible, every minute when an agent has reported lately, else
 * every five minutes (so new work still shows, but an abandoned session that
 * never finished doesn't keep the board reloading every minute).
 */
export function AgentSessionsProvider({
  sessions,
  children,
}: {
  sessions: AgentSession[];
  children: ReactNode;
}) {
  const router = useRouter();
  const byItem = useMemo(() => {
    const map: Record<string, AgentSession[]> = {};
    for (const s of sessions) (map[s.itemId] ??= []).push(s);
    return map;
  }, [sessions]);
  // When an open session last reported; -Infinity when none is open.
  const lastReport = Math.max(
    -Infinity,
    ...sessions.filter((s) => s.finishedAt === null).map((s) => s.lastActiveAt),
  );

  useEffect(() => {
    function refresh() {
      if (document.visibilityState === "visible") router.refresh();
    }
    // Each wait is chosen when it starts, so an agent going quiet slows the
    // polling down even if nothing on the board changes.
    let timer: ReturnType<typeof setTimeout>;
    function schedule() {
      const working = Date.now() - lastReport < IDLE_AFTER_MS;
      timer = setTimeout(() => {
        refresh();
        schedule();
      }, working ? POLL_ACTIVE_MS : POLL_QUIET_MS);
    }
    schedule();
    document.addEventListener("visibilitychange", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      clearTimeout(timer);
    };
  }, [lastReport, router]);

  return <SessionsContext value={byItem}>{children}</SessionsContext>;
}

/**
 * An item's agents: `agents` are those on it now (its open sessions, oldest
 * first) as avatars, and `sessions` the ones the board loaded for it (open,
 * plus the latest finished), for the detail dialog.
 */
export function useItemAgentSessions(itemId: string): {
  sessions: AgentSession[];
  agents: (AgentAvatarView & { session: AgentSession })[];
} {
  const sessions = useContext(SessionsContext)[itemId] ?? NO_SESSIONS;
  const clock = useMinuteClock(sessions.some((s) => s.finishedAt === null));
  const agents = useMemo(
    () =>
      sessions
        .filter((s) => s.finishedAt === null)
        .map((s) => ({
          id: s.id,
          name: s.agentName,
          status:
            clock === null || clock - s.lastActiveAt < IDLE_AFTER_MS
              ? ("working" as const)
              : ("idle" as const),
          session: s,
        })),
    [sessions, clock],
  );
  return { sessions, agents };
}
