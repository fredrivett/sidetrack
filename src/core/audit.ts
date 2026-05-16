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
  source: AuditSource;
  action: AuditAction;
  entityType: AuditEntity;
  entityId: string;
  projectId?: string | null;
  detail?: string;
  /** Multi-user seam. Defaults to 'me' until real identities exist. */
  actor?: string;
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
      actor: input.actor ?? "me",
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
  opts: { projectId?: string; source?: AuditSource; limit?: number } = {},
): AuditEntry[] {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const filters = [];
  if (opts.projectId) filters.push(eq(auditLog.projectId, opts.projectId));
  if (opts.source) filters.push(eq(auditLog.source, opts.source));

  const base = db.select().from(auditLog);
  const filtered =
    filters.length > 0 ? base.where(and(...filters)) : base;
  return filtered.orderBy(desc(auditLog.ts)).limit(limit).all();
}
