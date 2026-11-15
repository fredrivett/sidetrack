import { and, desc, eq, isNull, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { hasProjectAccess } from "./access";
import { users } from "./auth-schema";
import type { Db } from "./db";
import {
  type AuditAction,
  type AuditEntity,
  type AuditEntry,
  type AuditSource,
  auditLog,
  projects,
} from "./schema";

/** An audit row plus the resolved display name of its actor. */
export interface AuditEntryWithActor extends AuditEntry {
  /** Actor's name (falls back to email, then null for a deleted user);
   * "Sidetrack" for a system change. */
  actorName: string | null;
}

/**
 * Where a change came from: a bare source ("web", "mcp", …), or, for an agent
 * call, the source plus the API key the agent authenticated with, so the log
 * can say which agent made the change.
 */
export type AuditOrigin =
  | AuditSource
  | { source: "mcp"; agent: { keyId: string; name: string } };

/**
 * The actor of a `system` change, one nobody made (a repeating item
 * reopening). Not a user id, so it never resolves to a name.
 */
export const SYSTEM_ACTOR = "system";

export interface AuditInput {
  /** User id of whoever performed the action, or SYSTEM_ACTOR. */
  actor: string;
  source: AuditOrigin;
  action: AuditAction;
  entityType: AuditEntity;
  entityId: string;
  projectId?: string | null;
  detail?: string;
}

/**
 * Append one audit row. Call inside the same transaction as the mutation it
 * describes so the log can never drift from the data.
 */
export function recordAudit(db: Db, input: AuditInput): void {
  const origin =
    typeof input.source === "string" ? { source: input.source } : input.source;
  const agent = "agent" in origin ? origin.agent : null;
  // audit-exempt: this is the audit row itself.
  db.insert(auditLog)
    .values({
      id: nanoid(12),
      ts: Date.now(),
      actor: input.actor,
      source: origin.source,
      agentKeyId: agent?.keyId ?? null,
      agentName: agent?.name ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      projectId: input.projectId ?? null,
      detail: input.detail ?? "",
    })
    .run();
}

export function listAudit(
  db: Db,
  userId: string,
  opts: { projectId?: string; source?: AuditSource; limit?: number } = {},
): AuditEntryWithActor[] {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const filters = [];

  if (opts.projectId) {
    // Project-scoped view: every actor's activity on this one project. The
    // projectId comes from the client, so authorize it here — only someone
    // with access to the project (owner or member) may read its history. A
    // non-member (or unknown id) gets nothing rather than another user's
    // audit trail.
    const accessible = db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, opts.projectId), hasProjectAccess(userId)))
      .get();
    if (!accessible) return [];
    filters.push(eq(auditLog.projectId, opts.projectId));
  } else {
    // All-projects view: any actor's activity on a project the user can access,
    // plus the user's own *orphaned* rows — events with no live project, i.e.
    // account-level events (API keys, no projectId) and history of projects
    // they deleted. `projects.id IS NULL` (audit_log has no FK, so a missing
    // or deleted project yields a null left-join) scopes the actor fallback
    // to exactly those orphaned rows, so it can't leak rows the user authored
    // on a project they no longer have access to.
    const accessibleOrMine = or(
      hasProjectAccess(userId),
      and(isNull(projects.id), eq(auditLog.actor, userId)),
    );
    if (accessibleOrMine) filters.push(accessibleOrMine);
  }

  if (opts.source) filters.push(eq(auditLog.source, opts.source));

  // Left-join users to resolve the actor's display name; left-join (not
  // inner) so a deleted user's rows still appear, with a null name.
  const rows = db
    .select({ entry: auditLog, name: users.name, email: users.email })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actor))
    .leftJoin(projects, eq(projects.id, auditLog.projectId))
    .where(and(...filters))
    .orderBy(desc(auditLog.ts))
    .limit(limit)
    .all();

  return rows.map((r) => ({
    ...r.entry,
    actorName:
      r.entry.actor === SYSTEM_ACTOR ? "Sidetrack" : (r.name ?? r.email ?? null),
  }));
}
