import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { hasItemAccess, hasProjectAccess, hasWholeListAccess } from "./access";
import { users } from "./auth-schema";
import { announceChange } from "./changes";
import type { Db } from "./db";
import { describeEvent, hideAnchors, namesFor, type Part, plainText } from "./describe";
import { auditColumns, type ChangeEvent } from "./events";
import { writeNotifications } from "./notifications";
import {
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

/**
 * Whether the row is one `userId` may read for the item it's about. A row
 * about an item or its comments shows while they can see that item, or,
 * once it's deleted or gone elsewhere, if they see the whole list it was
 * on; one shown only someone's items mustn't read the rest's history.
 * Rows about no item pass. Needs `projects` joined to the row's list.
 */
function seesRowItem(userId: string) {
  const about = sql`(case when ${auditLog.entityType} = 'comment' then ${auditLog.parentId} else ${auditLog.entityId} end)`;
  return or(
    // A label's name can give a hidden item away, like the item's own history.
    sql`${auditLog.entityType} not in ('item', 'comment', 'label')`,
    isNull(projects.id),
    hasWholeListAccess(userId),
    sql`exists (select 1 from ${items} inner join ${projects} on ${projects.id} = ${items.projectId} where ${items.id} = ${about} and ${hasItemAccess(userId)})`,
  );
}

/**
 * Append one audit row. Call inside the same transaction as the mutation it
 * describes so the log can never drift from the data.
 */
export function recordAudit(db: Db, input: EventInput): void {
  const { event } = input;
  const columns = auditColumns(event);
  const origin =
    typeof input.source === "string" ? { source: input.source } : input.source;
  const agent = "agent" in origin ? origin.agent : null;
  // A sub-item's history also belongs to its parent's (listAudit's item
  // view), so note the parent on the row: the log has no other way to know
  // it once the sub-item is deleted or moved.
  const parentId =
    columns.parentId !== undefined || columns.entityType !== "item"
      ? (columns.parentId ?? null)
      : (db
          .select({ parentId: items.parentId })
          .from(items)
          .where(eq(items.id, columns.entityId))
          .get()?.parentId ?? null);
  const id = nanoid(12);
  const ts = Date.now();
  // audit-exempt: this is the audit row itself.
  db.insert(auditLog)
    .values({
      id,
      ts,
      actor: input.actor,
      source: origin.source,
      agentKeyId: agent?.keyId ?? null,
      agentName: agent?.name ?? null,
      action: columns.action,
      entityType: columns.entityType,
      entityId: columns.entityId,
      projectId: columns.projectId,
      parentId,
      event,
    })
    .run();
  // Who it concerns hears about it (notifications.ts), in this transaction.
  const notified = writeNotifications(db, {
    auditId: id,
    ts,
    actor: input.actor,
    source: origin.source,
    agent: agent?.name ?? null,
    event,
  });
  // Every audited change reaches open pages once it commits (see changes.ts).
  const itemId =
    columns.entityType === "item"
      ? columns.entityId
      : columns.entityType === "comment"
        ? (columns.parentId ?? undefined)
        : undefined;
  announceChange({
    actor: input.actor,
    projectId: columns.projectId,
    ...(itemId ? { itemId } : {}),
    ...(columns.entityType === "label" ? { wholeOnly: true } : {}),
    ...(rowsShowAll(event) ? { rows: true } : {}),
    ...(notified.length ? { notified } : {}),
  });
}

/**
 * Whether the item's own row shows all of what the event changed, for anyone
 * it didn't notify (see Change.rows). Not so for a new item, which its
 * creator follows, or labels, which can make new ones, or assignees, who
 * follow what they're on, or a move, which renumbers it.
 */
function rowsShowAll(event: ChangeEvent): boolean {
  switch (event.type) {
    case "item.updated":
      return !event.changes.labels && !event.changes.assignees;
    case "item.completed":
    case "item.cancelled":
    case "item.reopened":
    case "item.reordered":
    case "item.deleted":
    case "item.nested":
    case "item.unnested":
      return true;
    default:
      return false;
  }
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
      .select({ id: items.id, whole: sql<number>`${hasWholeListAccess(userId)}` })
      .from(items)
      .innerJoin(projects, eq(projects.id, items.projectId))
      .where(and(eq(items.id, opts.itemId), hasItemAccess(userId)))
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
    // Only the sub-items they see, for someone shown just one person's items
    // there: that person's under someone else's item, not the rest.
    if (!accessible.whole) filters.push(seesRowItem(userId));
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
    filters.push(eq(auditLog.projectId, opts.projectId), seesRowItem(userId));
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
    if (accessibleOrMine) filters.push(accessibleOrMine, seesRowItem(userId));
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
    userId,
  );
  return rows.map((r) => {
    const parts = r.entry.event ? describeEvent(r.entry.event, names) : null;
    return {
    ...r.entry,
    event: r.entry.event && hideAnchors(r.entry.event, names),
    parts,
    detail: parts ? plainText(parts) : r.entry.detail,
    actorName:
      r.entry.actor === SYSTEM_ACTOR ? "Sidetrack" : (r.name ?? r.email ?? null),
    actorImage: r.image,
    };
  });
}
