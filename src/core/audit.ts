import { and, desc, eq, isNull, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { hasProjectAccess } from "./access";
import { users } from "./auth-schema";
import { announceChange } from "./changes";
import type { Db } from "./db";
import { describeEvent, namesFor, type Part, plainText } from "./describe";
import { auditColumns, type ChangeEvent } from "./events";
import {
  type AuditAction,
  type AuditEntity,
  type AuditEntry,
  type AuditSource,
  auditLog,
  items,
  projects,
} from "./schema";

/** An audit row plus the resolved display name of its actor. */
export interface AuditEntryWithActor extends AuditEntry {
  /** What happened, for an event row, with who and what marked; null for a
   * free-text row, whose `detail` says it. An event row's `detail` is this
   * as plain text. */
  parts: Part[] | null;
  /** Actor's name (falls back to email, then null for a deleted user);
   * "Sidetrack" for a system change. */
  actorName: string | null;
  /** Actor's avatar image, when they've set one. */
  actorImage: string | null;
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

/** Who made a change, where from, and what it did (core/events.ts). */
export interface EventInput {
  /** User id of whoever performed the action, or SYSTEM_ACTOR. */
  actor: string;
  source: AuditOrigin;
  event: ChangeEvent;
}

/** A change described in free text: modules not yet moved to events. */
export interface AuditInput {
  /** User id of whoever performed the action, or SYSTEM_ACTOR. */
  actor: string;
  source: AuditOrigin;
  event?: undefined;
  action: AuditAction;
  entityType: AuditEntity;
  entityId: string;
  projectId?: string | null;
  /** For an item, the item it was a sub-item of when this happened. Read
   * from the item when omitted; pass it when the row no longer says, such
   * as once it's deleted or moved out. */
  parentId?: string | null;
  detail?: string;
}

/**
 * Append one audit row. Call inside the same transaction as the mutation it
 * describes so the log can never drift from the data.
 */
export function recordAudit(db: Db, input: AuditInput | EventInput): void {
  if (input.event) {
    const { event } = input;
    writeRow(db, { actor: input.actor, source: input.source, ...auditColumns(event), event });
  } else {
    writeRow(db, input);
  }
}

function writeRow(
  db: Db,
  input: Omit<AuditInput, "event"> & { event?: ChangeEvent },
): void {
  const origin =
    typeof input.source === "string" ? { source: input.source } : input.source;
  const agent = "agent" in origin ? origin.agent : null;
  // A sub-item's history also belongs to its parent's (listAudit's item
  // view), so note the parent on the row: the log has no other way to know
  // it once the sub-item is deleted or moved.
  const parentId =
    input.parentId !== undefined || input.entityType !== "item"
      ? (input.parentId ?? null)
      : (db
          .select({ parentId: items.parentId })
          .from(items)
          .where(eq(items.id, input.entityId))
          .get()?.parentId ?? null);
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
      parentId,
      detail: input.detail ?? "",
      event: input.event ?? null,
    })
    .run();
  // Every audited change reaches open pages once it commits (see changes.ts).
  announceChange({ actor: input.actor, projectId: input.projectId ?? null });
}

export function listAudit(
  db: Db,
  userId: string,
  opts: {
    projectId?: string;
    itemId?: string;
    source?: AuditSource;
    limit?: number;
  } = {},
): AuditEntryWithActor[] {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const filters = [];

  if (opts.itemId) {
    // Item-scoped view: every actor's activity on this one item and its
    // sub-items. Authorized like the item itself, through its current list,
    // so whoever can open the item can read its history and nobody else can.
    const accessible = db
      .select({ id: items.id })
      .from(items)
      .innerJoin(projects, eq(projects.id, items.projectId))
      .where(and(eq(items.id, opts.itemId), hasProjectAccess(userId)))
      .get();
    if (!accessible) return [];
    // Its sub-items' rows are those made while they were its sub-items,
    // including ones since deleted or moved out. Its comments' rows name it
    // as their parent too.
    filters.push(
      or(
        and(
          eq(auditLog.entityType, "item"),
          or(eq(auditLog.entityId, opts.itemId), eq(auditLog.parentId, opts.itemId)),
        ),
        and(eq(auditLog.entityType, "comment"), eq(auditLog.parentId, opts.itemId)),
      ),
    );
  } else if (opts.projectId) {
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
    .select({
      entry: auditLog,
      name: users.name,
      email: users.email,
      image: users.image,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actor))
    .leftJoin(projects, eq(projects.id, auditLog.projectId))
    .where(and(...filters))
    .orderBy(desc(auditLog.ts))
    .limit(limit)
    .all();

  const names = namesFor(
    db,
    rows.flatMap((r) => (r.entry.event ? [r.entry.event] : [])),
  );
  return rows.map((r) => {
    const parts = r.entry.event ? describeEvent(r.entry.event, names) : null;
    return {
    ...r.entry,
    parts,
    detail: parts ? plainText(parts) : r.entry.detail,
    actorName:
      r.entry.actor === SYSTEM_ACTOR ? "Sidetrack" : (r.name ?? r.email ?? null),
    actorImage: r.image,
    };
  });
}
