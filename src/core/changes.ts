import { and, eq, inArray, or } from "drizzle-orm";
import { getPostHog } from "../lib/posthog";
import { hasProjectAccess } from "./access";
import type { Db } from "./db";
import { projectMembers, projects, spaceMembers } from "./schema";

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
}

type Listener = (changes: Change[]) => void;

declare global {
  var __sidetrackChanges: { listeners: Set<Listener>; pending: Change[] } | undefined;
}

// On globalThis, like the DB, so Server Actions, MCP tools, and the events
// route share one, whichever bundle loaded this module.
const bus = (globalThis.__sidetrackChanges ??= { listeners: new Set(), pending: [] });

/**
 * Announce a change once the synchronous work in progress has finished, and
 * with it the transaction the change was made in: better-sqlite3 transactions
 * never span an await. Changes announced together reach each listener as one
 * batch. A change rolled back after announcing costs a reload that shows
 * nothing new.
 */
export function announceChange(change: Change): void {
  if (bus.pending.push(change) > 1) return;
  setImmediate(() => {
    const changes = bus.pending.splice(0);
    for (const listener of bus.listeners) {
      // A throw here would be uncaught and stop the server.
      try {
        listener(changes);
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
 * removed from, counts too, so it leaves their board. Returns the
 * unsubscribe function.
 */
export function watchChanges(db: Db, userId: string, onChange: () => void): () => void {
  let before = audience(db, userId);
  const listener: Listener = (changes) => {
    const after = audience(db, userId);
    const affected = changes.some(
      ({ actor, projectId }) =>
        actor === userId ||
        (projectId === null
          ? before.people.has(actor) || after.people.has(actor)
          : before.lists.has(projectId) || after.lists.has(projectId)),
    );
    before = after;
    if (affected) onChange();
  };
  return onChanges(listener);
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
  return {
    lists: new Set([...ids, ...invites.map((i) => i.projectId)]),
    people: new Set([
      ...shown.map((p) => p.owner),
      ...members.map((m) => m.userId),
      ...spacePeople.map((m) => m.userId),
    ]),
  };
}
