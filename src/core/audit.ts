import { and, desc, eq, isNull, or } from "drizzle-orm";
import { nanoid } from "nanoid";
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
  /** Actor's name (falls back to email, then null for a deleted user). */
  actorName: string | null;
}

export interface AuditInput {
  /** User id of whoever performed the action. */
  actor: string;
  source: AuditSource;
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
  db.insert(auditLog)
    .values({
      id: nanoid(12),
      ts: Date.now(),
      actor: input.actor,
      source: input.source,
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
    // projectId comes from the client, so authorize it here — only the
    // project's owner may read its history. A non-owner (or unknown id)
    // gets nothing rather than another user's audit trail.
    const owned = db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, opts.projectId), eq(projects.userId, userId)))
      .get();
    if (!owned) return [];
    filters.push(eq(auditLog.projectId, opts.projectId));
  } else {
    // All-projects view: any actor's activity on a project the user owns,
    // plus the user's own *orphaned* rows — events with no live project, i.e.
    // account-level events (API keys, no projectId) and history of projects
    // they deleted. `projects.id IS NULL` (audit_log has no FK, so a missing
    // or deleted project yields a null left-join) scopes the actor fallback
    // to exactly those orphaned rows, so it can't leak rows the user authored
    // on a project they don't own. (When sharing lands, the first arm becomes
    // a membership check rather than ownership.)
    const ownedOrMine = or(
      eq(projects.userId, userId),
      and(isNull(projects.id), eq(auditLog.actor, userId)),
    );
    if (ownedOrMine) filters.push(ownedOrMine);
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
    actorName: r.name ?? r.email ?? null,
  }));
}
