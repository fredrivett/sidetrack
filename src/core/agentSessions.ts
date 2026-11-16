import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { AgentRequest } from "../lib/agentRequest";
import { formatItemRef, workBranchName } from "../lib/itemRef";
import { normalizeWebUrl } from "../lib/url";
import { hasProjectAccess, isListAdmin } from "./access";
import { apiKeys } from "./auth-schema";
import { type AuditOrigin, recordAudit } from "./audit";
import type { Db } from "./db";
import { assigneeLabel, getItem } from "./items";
import {
  type AgentSession,
  type Item,
  agentSessions,
  agentWebhooks,
  items,
  projects,
} from "./schema";

// An agent's work session on an item (see the agentSessions table). Only an
// agent can hold one, so these take the MCP origin with its API key: the key
// is the agent's identity. Reads go through the item's project, like PR links.

/** An agent's call: the mcp source plus the API key it authenticated with. */
export type AgentOrigin = Extract<AuditOrigin, { source: "mcp" }>;

const NOTE_MAX = 280;

function cleanNote(raw: string): string {
  const note = raw.trim().replace(/\s+/g, " ");
  if (!note) throw new Error("note is required");
  // Count characters (code points), not UTF-16 units, so an emoji counts once.
  const length = [...note].length;
  if (length > NOTE_MAX) {
    throw new Error(`note is too long (${length} characters, max ${NOTE_MAX})`);
  }
  return note;
}

function openSession(db: Db, itemId: string, agentKeyId: string) {
  return db
    .select()
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.itemId, itemId),
        eq(agentSessions.agentKeyId, agentKeyId),
        isNull(agentSessions.finishedAt),
      ),
    )
    .get();
}

function itemOrThrow(db: Db, userId: string, itemId: string): Item {
  const item = getItem(db, userId, itemId);
  if (!item) throw new Error(`item not found: ${itemId}`);
  return item;
}

/**
 * What the board shows, oldest first: the open sessions on items the user can
 * access, plus each item's most recently finished one. Older history stays in
 * the table (and the audit log) without being reloaded on every refresh.
 */
export function listAllAgentSessions(db: Db, userId: string): AgentSession[] {
  const latestFinished = sql`${agentSessions.id} = (
    select s2.id from agent_sessions s2
    where s2.item_id = ${agentSessions.itemId} and s2.finished_at is not null
    order by s2.finished_at desc, s2.rowid desc limit 1
  )`;
  return db
    .select({ agentSessions })
    .from(agentSessions)
    .innerJoin(items, eq(items.id, agentSessions.itemId))
    .innerJoin(projects, eq(projects.id, items.projectId))
    .where(
      and(hasProjectAccess(userId), or(isNull(agentSessions.finishedAt), latestFinished)),
    )
    .orderBy(asc(agentSessions.startedAt))
    .all()
    .map((row) => row.agentSessions);
}

/** The agents working on an item now (its open sessions), oldest first. */
export function listOpenAgentSessions(
  db: Db,
  userId: string,
  itemId: string,
): AgentSession[] {
  if (!getItem(db, userId, itemId)) return [];
  return db
    .select()
    .from(agentSessions)
    .where(and(eq(agentSessions.itemId, itemId), isNull(agentSessions.finishedAt)))
    .orderBy(asc(agentSessions.startedAt))
    .all();
}

/**
 * Open a work session for the calling agent on an item, assigning the key's
 * owner when nobody is assigned yet. Calling it again while the session is
 * open resumes it: it marks the agent active and updates the thread URL when
 * one is given.
 */
export function startWork(
  db: Db,
  userId: string,
  itemId: string,
  input: { threadUrl?: string | null },
  source: AgentOrigin,
): AgentSession {
  const item = itemOrThrow(db, userId, itemId);
  if (item.completedAt !== null) {
    throw new Error(`"${item.title}" is completed; reopen it before starting work on it`);
  }
  const threadUrl = input.threadUrl
    ? normalizeWebUrl(input.threadUrl, "thread URL")
    : null;
  const { keyId, name } = source.agent;
  const existing = openSession(db, itemId, keyId);
  const now = Date.now();
  // The branch is fixed when the session opens, from the bare ref (never
  // owner-qualified, which would put a slash in it).
  const project = db
    .select({ prefix: projects.prefix })
    .from(projects)
    .where(eq(projects.id, item.projectId))
    .get();
  if (!project) throw new Error(`list not found: ${item.projectId}`);
  const branch = workBranchName(formatItemRef(project.prefix, item.number), item.title);

  db.transaction((tx) => {
    const t = tx as unknown as Db;
    if (existing) {
      tx.update(agentSessions)
        .set({
          lastActiveAt: now,
          agentName: name,
          ...(threadUrl ? { threadUrl } : {}),
          // A session from before branches were stored has none yet.
          ...(existing.branch ? {} : { branch }),
        })
        .where(eq(agentSessions.id, existing.id))
        .run();
      recordAudit(t, {
        actor: userId,
        source,
        action: "start",
        entityType: "item",
        entityId: itemId,
        projectId: item.projectId,
        detail: `resumed work on "${item.title}"`,
      });
      return;
    }
    const assign = item.assigneeIds.length === 0;
    tx.insert(agentSessions)
      .values({
        id: nanoid(12),
        itemId,
        userId,
        agentKeyId: keyId,
        agentName: name,
        threadUrl,
        branch,
        startedAt: now,
        lastActiveAt: now,
      })
      .run();
    if (assign) {
      tx.update(items).set({ assigneeIds: [userId] }).where(eq(items.id, itemId)).run();
    }
    recordAudit(t, {
      actor: userId,
      source,
      action: "start",
      entityType: "item",
      entityId: itemId,
      projectId: item.projectId,
      detail:
        `started work on "${item.title}"` +
        (assign ? `, assigned to ${assigneeLabel(t, userId)}` : ""),
    });
  });

  const session = openSession(db, itemId, keyId);
  // Guaranteed by the committed transaction; a miss means an invariant broke.
  if (!session) throw new Error(`work session not found after start: ${itemId}`);
  return session;
}

/** Record progress on the calling agent's open session, marking it active. */
export function reportWork(
  db: Db,
  userId: string,
  itemId: string,
  rawNote: string,
  source: AgentOrigin,
): AgentSession {
  const item = itemOrThrow(db, userId, itemId);
  const note = cleanNote(rawNote);
  const session = openSession(db, itemId, source.agent.keyId);
  if (!session) {
    throw new Error(
      `${source.agent.name} has no open work session on "${item.title}"; call start_work first`,
    );
  }
  const now = Date.now();
  db.transaction((tx) => {
    tx.update(agentSessions)
      .set({ note, lastActiveAt: now })
      .where(eq(agentSessions.id, session.id))
      .run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      action: "report",
      entityType: "item",
      entityId: itemId,
      projectId: item.projectId,
      detail: `reported on "${item.title}": ${note}`,
    });
  });
  return { ...session, note, lastActiveAt: now };
}

/**
 * Close the calling agent's open session on an item, leaving the item itself
 * as it is. Returns null, writing nothing, when there's no open session.
 */
export function finishWork(
  db: Db,
  userId: string,
  itemId: string,
  input: { note?: string | null },
  source: AgentOrigin,
): AgentSession | null {
  const item = itemOrThrow(db, userId, itemId);
  // A blank closing note is no note, so it can't stop the session closing.
  const note = input.note?.trim() ? cleanNote(input.note) : null;
  const session = openSession(db, itemId, source.agent.keyId);
  if (!session) return null;
  const now = Date.now();
  const patch = { finishedAt: now, lastActiveAt: now, ...(note ? { note } : {}) };
  db.transaction((tx) => {
    tx.update(agentSessions).set(patch).where(eq(agentSessions.id, session.id)).run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      action: "finish",
      entityType: "item",
      entityId: itemId,
      projectId: item.projectId,
      detail: `finished work on "${item.title}"${note ? `: ${note}` : ""}`,
    });
  });
  return { ...session, ...patch };
}

/**
 * End every agent's open session on an item for a reason outside the agents,
 * such as its pull request closing without merging. Each ended session keeps
 * the reason as its last note and is audited on its own. Returns how many
 * sessions it ended.
 */
export function endAgentSessions(
  db: Db,
  userId: string,
  itemId: string,
  reason: string,
  source: AuditOrigin,
): number {
  const item = itemOrThrow(db, userId, itemId);
  const open = listOpenAgentSessions(db, userId, itemId);
  if (open.length === 0) return 0;
  const now = Date.now();
  db.transaction((tx) => {
    for (const session of open) {
      tx.update(agentSessions)
        .set({ finishedAt: now, note: reason })
        .where(eq(agentSessions.id, session.id))
        .run();
      recordAudit(tx as unknown as Db, {
        actor: userId,
        source,
        action: "finish",
        entityType: "item",
        entityId: itemId,
        projectId: item.projectId,
        detail: `ended ${session.agentName}'s work on "${item.title}": ${reason}`,
      });
    }
  });
  return open.length;
}

// Starting and stopping an agent from Sidetrack: the list's admin assigns one
// of their agents (an API key with a webhook, see agentWebhooks.ts) in the
// assignee picker. That opens the agent's session at once, with no thread
// yet, and returns the request for the caller to send to the agent's webhook
// once the change has committed. When the agent's thread calls start_work
// with the same key, it resumes that session and fills in its thread URL.

/** One of the user's agents that Sidetrack can start: a key with a webhook. */
export type StartableAgent = { keyId: string; name: string };

export function listStartableAgents(db: Db, userId: string): StartableAgent[] {
  return db
    .select({ keyId: apiKeys.id, name: apiKeys.name })
    .from(agentWebhooks)
    .innerJoin(apiKeys, eq(apiKeys.id, agentWebhooks.keyId))
    .where(eq(apiKeys.userId, userId))
    .orderBy(asc(apiKeys.name), asc(apiKeys.id))
    .all();
}

/** The user's own key, with its webhook when it has one. */
function ownAgent(db: Db, userId: string, keyId: string) {
  const agent = db
    .select({ name: apiKeys.name, url: agentWebhooks.url, secret: agentWebhooks.secret })
    .from(apiKeys)
    .leftJoin(agentWebhooks, eq(agentWebhooks.keyId, apiKeys.id))
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)))
    .get();
  if (!agent) throw new Error(`agent not found: ${keyId}`);
  return agent;
}

function projectOf(db: Db, item: Item) {
  const project = db.select().from(projects).where(eq(projects.id, item.projectId)).get();
  if (!project) throw new Error(`list not found: ${item.projectId}`);
  return project;
}

/**
 * Ask one of the user's agents to work on an item: open its session and
 * return the start request to send. Only the list's admin may, on a list with
 * a repository, since that decides where the agent works and with whose
 * secrets. If the agent already has a session open on the item, nothing
 * changes and there's no request, so assigning twice starts it once.
 */
export function requestWork(
  db: Db,
  userId: string,
  itemId: string,
  keyId: string,
  source: AuditOrigin,
): { session: AgentSession; request: AgentRequest | null } {
  const item = itemOrThrow(db, userId, itemId);
  const project = projectOf(db, item);
  if (!isListAdmin(db, userId, project)) {
    throw new Error("only the list's admin can start an agent on its items");
  }
  const agent = ownAgent(db, userId, keyId);
  if (!agent.url || !agent.secret) {
    throw new Error(`${agent.name} isn't set to start work when assigned`);
  }
  if (!project.repository) {
    throw new Error(`"${project.name}" has no repository for an agent to work in`);
  }
  if (item.completedAt !== null) {
    throw new Error(`"${item.title}" is completed; reopen it before starting an agent on it`);
  }
  const existing = openSession(db, itemId, keyId);
  if (existing) return { session: existing, request: null };

  const ref = formatItemRef(project.prefix, item.number);
  const now = Date.now();
  const session: AgentSession = {
    id: nanoid(12),
    itemId,
    userId,
    agentKeyId: keyId,
    agentName: agent.name,
    threadUrl: null,
    branch: workBranchName(ref, item.title),
    note: null,
    startedAt: now,
    lastActiveAt: now,
    finishedAt: null,
  };
  db.transaction((tx) => {
    tx.insert(agentSessions).values(session).run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      action: "start",
      entityType: "item",
      entityId: itemId,
      projectId: item.projectId,
      detail: `asked ${agent.name} to work on "${item.title}"`,
    });
  });
  return {
    session,
    request: {
      url: agent.url,
      secret: agent.secret,
      idempotencyKey: session.id,
      body: { type: "start", sessionId: session.id, itemId, ref, repository: project.repository },
    },
  };
}

/**
 * Stop one of the user's agents working on an item: end its open session,
 * so the board stops showing it and its reports are refused, and return the
 * stop request to send, or null when its key has no webhook left. Any key's
 * owner can stop their own agent, admin or not. `reason`, when given, is kept
 * as the session's last note, such as why a start didn't go through. Returns
 * undefined, writing nothing, when the agent has no open session there.
 */
export function stopWork(
  db: Db,
  userId: string,
  itemId: string,
  keyId: string,
  source: AuditOrigin,
  reason?: string,
): AgentRequest | null | undefined {
  const item = itemOrThrow(db, userId, itemId);
  const agent = ownAgent(db, userId, keyId);
  const session = openSession(db, itemId, keyId);
  if (!session) return undefined;
  const now = Date.now();
  db.transaction((tx) => {
    tx.update(agentSessions)
      .set({ finishedAt: now, note: reason ?? "Unassigned in Sidetrack" })
      .where(eq(agentSessions.id, session.id))
      .run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      action: "finish",
      entityType: "item",
      entityId: itemId,
      projectId: item.projectId,
      detail: `stopped ${agent.name} on "${item.title}"${reason ? `: ${reason}` : ""}`,
    });
  });
  if (!agent.url || !agent.secret) return null;
  const project = projectOf(db, item);
  return {
    url: agent.url,
    secret: agent.secret,
    idempotencyKey: `${session.id}:stop`,
    body: {
      type: "stop",
      sessionId: session.id,
      itemId,
      ref: formatItemRef(project.prefix, item.number),
    },
  };
}
