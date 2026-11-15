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

/**
 * The time, to the minute, or null during the server render and hydration,
 * where every open session counts as working.
 */
function useMinuteClock(): number | null {
  return useSyncExternalStore(subscribe, () => now, () => null);
}

/**
 * Provides the sessions to the rows and sheets, and keeps them current
 * without real time: the board reloads when the tab comes back into view, and
 * every minute while it's visible and an agent is on any item.
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
  const anyOpen = sessions.some((s) => s.finishedAt === null);

  useEffect(() => {
    function refresh() {
      if (document.visibilityState === "visible") router.refresh();
    }
    document.addEventListener("visibilitychange", refresh);
    const poll = anyOpen ? setInterval(refresh, TICK_MS) : undefined;
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      clearInterval(poll);
    };
  }, [anyOpen, router]);

  return <SessionsContext value={byItem}>{children}</SessionsContext>;
}

/**
 * An item's agents: `agents` are those on it now (its open sessions, oldest
 * first) as avatars, and `sessions` every session it has had, for the sheet.
 */
export function useItemAgentSessions(itemId: string): {
  sessions: AgentSession[];
  agents: (AgentAvatarView & { session: AgentSession })[];
} {
  const sessions = useContext(SessionsContext)[itemId] ?? NO_SESSIONS;
  const clock = useMinuteClock();
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
