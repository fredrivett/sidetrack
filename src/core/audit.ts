import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "./db";
import {
  type AuditAction,
  type AuditEntity,
  type AuditEntry,
  type AuditSource,
  auditLog,
} from "./schema";

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
): AuditEntry[] {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  // Scope to rows the user is the actor for. The audit table outlives both
  // projects and users (no FK), so this filter is the privacy boundary —
  // rows belonging to other users' actions never leak through.
  const filters = [eq(auditLog.actor, userId)];
  if (opts.projectId) filters.push(eq(auditLog.projectId, opts.projectId));
  if (opts.source) filters.push(eq(auditLog.source, opts.source));
  return db
    .select()
    .from(auditLog)
    .where(and(...filters))
    .orderBy(desc(auditLog.ts))
    .limit(limit)
    .all();
}
