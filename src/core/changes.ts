import { and, eq, inArray, or, sql } from "drizzle-orm";
import { getPostHog } from "../lib/posthog";
import { hasItemAccess, hasProjectAccess, hasWholeListAccess } from "./access";
import type { Db } from "./db";
import { items, projectMembers, projects, spaceMembers } from "./schema";

/**
 * Live updates. Every committed change is announced here, and each open page
 * hears about the ones that affect what its viewer sees, then reloads (see
 * /api/events). recordAudit announces every audited change, so a mutation
 * that follows the audit-log rule gets live updates for free. Only an
 * audit-exempt write that still changes what people see (like setPrState)
 * calls announceChange itself.
 */

/** Who made a change, and the list it touched: null for an account-level change, such as a new username. */
export interface Change {
  actor: string;
  projectId: string | null;
  /** The item it was about, if any: someone shown only part of the list hears only of theirs. */
  itemId?: string;
  /** Not for someone shown only part of the list, such as a label's change. */
  wholeOnly?: true;
  /**
   * The item's row (or its absence, once deleted) shows all of the change,
   * to anyone it didn't notify: their board can read just that row instead
   * of reloading (see /api/items).
   */
  rows?: true;
  /** The people it notified, whose inbox has something new. */
  notified?: string[];
}

/**
 * What a batch changed for one viewer: the items it was about, with any it
 * showed them or took away from a list they see only part of (nesting one of
 * theirs brings its new checklist); whether reading those rows shows all of
 * it (each change has `rows` and notified nobody of them); and the batch's
 * first change number, so a page can tell a batch of only its own saves.
 * Null when it was about more than items, such as a list.
 */
export type Seen = { items: string[]; rows: boolean; first: number } | null;

/** A batch of changes, and the number of the last one in it (see changeSeq). */
type Listener = (changes: Change[], seq: number) => void;

declare global {
  var __sidetrackChanges:
    | { listeners: Set<Listener>; pending: Change[]; seq: number }
    | undefined;
}

// On globalThis, like the DB, so Server Actions, MCP tools, and the events
// route share one, whichever bundle loaded this module. Numbering starts at
// the time the server started, so a restarted server's numbers are higher
// than any its predecessor gave out.
const bus = (globalThis.__sidetrackChanges ??= {
  listeners: new Set(),
  pending: [],
  seq: Date.now(),
});

/**
 * The number of the latest change. Each change gets the next one as it's
 * made, before its transaction commits, and nothing else runs in between: so
 * a page that reads this before it reads its data shows every change up to
 * it, and needs no reload for the events of those changes (LiveUpdates).
 */
export function changeSeq(): number {
  return bus.seq;
}

/**
 * Announce a change once the synchronous work in progress has finished, and
 * with it the transaction the change was made in: better-sqlite3 transactions
 * never span an await. Changes announced together reach each listener as one
 * batch. A change rolled back after announcing costs a reload that shows
 * nothing new.
 */
export function announceChange(change: Change): void {
  bus.seq++;
  if (bus.pending.push(change) > 1) return;
  setImmediate(() => {
    const changes = bus.pending.splice(0);
    const seq = bus.seq;
    for (const listener of bus.listeners) {
      // A throw here would be uncaught and stop the server.
      try {
        listener(changes, seq);
      } catch (error) {
        getPostHog()?.captureException(error);
      }
    }
  });
}

/** Call listener with each batch of committed changes. Returns the unsubscribe function. */
export function onChanges(listener: Listener): () => void {
  bus.listeners.add(listener);
  return () => {
    bus.listeners.delete(listener);
  };
}

/**
 * Call onChange after each batch of changes that affects what userId sees:
 * their own changes, changes to a list they can see or are invited to, and
 * account and Space changes by the people they share lists or a Space with,
 * whose names and avatars show on those lists (Space changes have no list). A list they have just lost, deleted or
 * removed from, counts too, so it leaves their board. onChange gets the
 * batch's number (changeSeq) and what it changed for them (Seen). Returns
 * the unsubscribe function.
 */
export function watchChanges(
  db: Db,
  userId: string,
  onChange: (seq: number, seen: Seen) => void,
): () => void {
  let before = audience(db, userId);
  let beforeItems = visibleItems(db, userId, before.partial);
  const listener: Listener = (changes, seq) => {
    const after = audience(db, userId);
    const partial = (id: string) => before.partial.has(id) || after.partial.has(id);
    // Re-read what they can see only when this batch touched a list they
    // see part of, or which lists those are changed: most batches don't.
    const same =
      before.partial.size === after.partial.size && [...after.partial].every((id) => before.partial.has(id));
    const afterItems =
      same && !changes.some((c) => c.projectId !== null && partial(c.projectId))
        ? beforeItems
        : visibleItems(db, userId, after.partial);
    const affected = changes.filter(
      ({ actor, projectId, itemId, wholeOnly }) =>
        actor === userId ||
        (projectId === null
          ? before.people.has(actor) || after.people.has(actor)
          : (before.lists.has(projectId) || after.lists.has(projectId)) &&
            // On a list they see only part of, only an item they could see
            // before or can now: one leaving their board still reloads it.
            (!partial(projectId) ||
              (!wholeOnly && (!itemId || beforeItems.has(itemId) || afterItems.has(itemId))))),
    );
    const ids = new Set(affected.flatMap((c) => (c.itemId ? [c.itemId] : [])));
    for (const id of beforeItems) if (!afterItems.has(id)) ids.add(id);
    for (const id of afterItems) if (!beforeItems.has(id)) ids.add(id);
    before = after;
    beforeItems = afterItems;
    if (affected.length === 0) return;
    if (!affected.every((c) => c.itemId)) return onChange(seq, null);
    onChange(seq, {
      items: [...ids],
      rows: affected.every((c) => c.rows && !c.notified?.includes(userId)),
      // Each change in the batch has the next number (announceChange).
      first: seq - changes.length + 1,
    });
  };
  return onChanges(listener);
}

/** The items userId can see on the lists they see only part of. */
function visibleItems(db: Db, userId: string, partial: Set<string>): Set<string> {
  if (partial.size === 0) return new Set();
  return new Set(
    db
      .select({ id: items.id })
      .from(items)
      .innerJoin(projects, eq(projects.id, items.projectId))
      .where(and(inArray(items.projectId, [...partial]), hasItemAccess(userId)))
      .all()
      .map((i) => i.id),
  );
}

/** The lists whose changes userId sees, and the people they share them or a
 * Space with: everyone in, or invited to, their Spaces and the Spaces their
 * lists are in (members see invitees listed, so an invitee declining changes
 * what they see), and the admins of a Space they're invited to, who change
 * or revoke the invite. */
function audience(db: Db, userId: string) {
  const shown = db
    .select({ id: projects.id, owner: projects.userId, spaceId: projects.spaceId })
    .from(projects)
    .where(hasProjectAccess(userId))
    .all();
  const ids = shown.map((p) => p.id);
  const members = ids.length
    ? db
        .select({ userId: projectMembers.userId })
        .from(projectMembers)
        .where(
          and(inArray(projectMembers.projectId, ids), eq(projectMembers.status, "accepted")),
        )
        .all()
    : [];
  const invites = db
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .where(and(eq(projectMembers.userId, userId), eq(projectMembers.status, "pending")))
    .all();
  const mine = db
    .select({ spaceId: spaceMembers.spaceId, status: spaceMembers.status })
    .from(spaceMembers)
    .where(eq(spaceMembers.userId, userId))
    .all();
  const joined = [
    ...mine.filter((m) => m.status === "accepted").map((m) => m.spaceId),
    ...shown.flatMap((p) => (p.spaceId ? [p.spaceId] : [])),
  ];
  const invitedTo = mine.filter((m) => m.status === "pending").map((m) => m.spaceId);
  const spacePeople = joined.length || invitedTo.length
    ? db
        .select({ userId: spaceMembers.userId })
        .from(spaceMembers)
        .where(
          or(
            inArray(spaceMembers.spaceId, joined),
            and(
              inArray(spaceMembers.spaceId, invitedTo),
              eq(spaceMembers.status, "accepted"),
              eq(spaceMembers.role, "admin"),
            ),
          ),
        )
        .all()
    : [];
  // Lists they see only part of.
  const partial = db
    .select({ id: projects.id })
    .from(projects)
    .where(and(hasProjectAccess(userId), sql`not (${hasWholeListAccess(userId)})`))
    .all()
    .map((p) => p.id);
  return {
    partial: new Set(partial),
    lists: new Set([...ids, ...invites.map((i) => i.projectId)]),
    people: new Set([
      ...shown.map((p) => p.owner),
      ...members.map((m) => m.userId),
      ...spacePeople.map((m) => m.userId),
    ]),
  };
}
