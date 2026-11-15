"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";
import type { AgentSession } from "@/core/schema";
import type { AgentAvatarView } from "./UserAvatar";

/** An agent with no report for this long shows as idle rather than working. */
const IDLE_AFTER_MS = 15 * 60_000;
const TICK_MS = 60_000;

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
 * Provides the sessions to the rows and dialogs. They stay current with the
 * rest of the board: agents' reports are audited, so each one reloads it
 * (LiveUpdates).
 */
export function AgentSessionsProvider({
  sessions,
  children,
}: {
  sessions: AgentSession[];
  children: ReactNode;
}) {
  const byItem = useMemo(() => {
    const map: Record<string, AgentSession[]> = {};
    for (const s of sessions) (map[s.itemId] ??= []).push(s);
    return map;
  }, [sessions]);
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
