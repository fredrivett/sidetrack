import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { formatItemRef, workBranchName } from "../lib/itemRef";
import { normalizeWebUrl } from "../lib/url";
import { hasProjectAccess } from "./access";
import { type AuditOrigin, recordAudit } from "./audit";
import type { Db } from "./db";
import { assigneeLabel, getItem } from "./items";
import {
  type AgentSession,
  type Item,
  agentSessions,
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
