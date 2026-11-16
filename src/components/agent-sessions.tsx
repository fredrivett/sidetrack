"use client";

import {
  createContext,
  type ReactNode,
  type TransitionStartFunction,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";
import { startAgentAction, stopAgentAction } from "@/app/actions";
import type { StartableAgent } from "@/core/agentSessions";
import type { AgentSession, Item } from "@/core/schema";
import { runAction } from "./run-action";
import type { AgentAvatarView } from "./UserAvatar";

/** An agent with no report for this long shows as idle rather than working. */
const IDLE_AFTER_MS = 15 * 60_000;
const TICK_MS = 60_000;

// The board's agent work sessions, by item, read by each row and detail sheet
// (useItemAgentSessions) instead of being passed down through every view.
const SessionsContext = createContext<Record<string, AgentSession[]>>({});
const NO_SESSIONS: AgentSession[] = [];
// The viewer's agents Sidetrack can start, and the lists they may start them on.
const StartableContext = createContext<{
  viewerId: string | null;
  agents: StartableAgent[];
  lists: ReadonlySet<string>;
}>({ viewerId: null, agents: [], lists: new Set() });

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
  viewerId,
  startable = [],
  startableIn = [],
  children,
}: {
  sessions: AgentSession[];
  /** Whose agents the pickers offer and can stop. */
  viewerId: string;
  startable?: StartableAgent[];
  startableIn?: string[];
  children: ReactNode;
}) {
  const byItem = useMemo(() => {
    const map: Record<string, AgentSession[]> = {};
    for (const s of sessions) (map[s.itemId] ??= []).push(s);
    return map;
  }, [sessions]);
  // Joined so the set (and every picker) only changes when the lists do.
  const listsKey = startableIn.join(",");
  const startableValue = useMemo(
    () => ({
      viewerId,
      agents: startable,
      lists: new Set(listsKey ? listsKey.split(",") : []),
    }),
    [viewerId, startable, listsKey],
  );
  return (
    <SessionsContext value={byItem}>
      <StartableContext value={startableValue}>{children}</StartableContext>
    </SessionsContext>
  );
}

/** One of the viewer's agents as the assignee picker lists it. */
export type AgentOption = StartableAgent & { working: boolean };

/**
 * The viewer's agents for an item's assignee picker, and how to start or stop
 * one. They're offered on open items in lists the viewer can start them on
 * (see AgentSessionsProvider). One of theirs already working on the item is
 * listed whatever else is true, even with its webhook removed or its key
 * revoked, so it can always be stopped.
 * The change holds: `start` is the item's transition, which dims it until the
 * agent's webhook answers, and a failure says so in a toast.
 */
export function useAgentAssignment(
  item: Pick<Item, "id" | "projectId" | "completedAt">,
  start: TransitionStartFunction,
): { agentOptions: AgentOption[]; setAgent: (keyId: string, on: boolean) => void } {
  const startable = useContext(StartableContext);
  const sessions = useContext(SessionsContext)[item.id] ?? NO_SESSIONS;
  const canStart = startable.lists.has(item.projectId) && item.completedAt === null;
  const agentOptions = useMemo(() => {
    const working = sessions
      .filter((s) => s.finishedAt === null && s.userId === startable.viewerId)
      .map((s) => ({ keyId: s.agentKeyId, name: s.agentName, working: true }));
    const idle = canStart
      ? startable.agents
          .filter((a) => !working.some((w) => w.keyId === a.keyId))
          .map((a) => ({ ...a, working: false }))
      : [];
    return [...working, ...idle].sort((a, b) => a.name.localeCompare(b.name));
  }, [startable, sessions, canStart]);
  const setAgent = useCallback(
    (keyId: string, on: boolean) => {
      const name = agentOptions.find((a) => a.keyId === keyId)?.name ?? "the agent";
      start(async () => {
        await runAction(
          on ? startAgentAction(item.id, keyId) : stopAgentAction(item.id, keyId),
          `${on ? "start" : "stop"} ${name}`,
        );
      });
    },
    [agentOptions, start, item.id],
  );
  return { agentOptions, setAgent };
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
