import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { roleWords } from "../lib/roles";
import { nanoid } from "nanoid";
import { getEnv } from "../lib/env";
import { formatItemRef } from "../lib/itemRef";
import { getPostHog } from "../lib/posthog";
import { isEmoji } from "../lib/projectIcon";
import { dayOf } from "../lib/time";
import { type PushMessage, sendPush } from "../lib/push";
import { canSeeItem, hasItemAccess, hasProjectAccess, listAccess, listMemberIds } from "./access";
import { users } from "./auth-schema";
import { onChanges } from "./changes";
import type { Db } from "./db";
import { SYSTEM_ACTOR } from "./audit";
import { duePart, type Part, plainText } from "./describe";
import { autoFollow, followersOf } from "./follows";
import type { ChangeEvent, DueAt, ItemAt, PersonAt } from "./events";
import { isLooking } from "./presence";
import { remindDue } from "./reminders";
import { forgetPushSubscriptions, pushTargets } from "./push";
import {
  auditLog,
  type AuditSource,
  comments,
  items,
  NOTIFICATION_LEVELS,
  NOTIFICATION_REASONS,
  type NotificationLevel,
  type ListRole,
  type NotificationReason,
  type SpaceRole,
  notificationSettings,
  notifications,
  projectMembers,
  projects,
  spaceMembers,
  spaces,
} from "./schema";

// Notifications: what someone should hear about a change. The change's
// event (core/events.ts) says what happened; a rule here says who it
// concerns and why. recordAudit runs the rules in the change's transaction
// and writes one row per recipient: who, why, and the audit row. Nothing is
// worded then. The inbox and the push read the event back and say it to
// its reader ("Sam assigned you Fix tap"), with current names, and only
// while the reader can still open what it's about.

/** A notification as the inbox shows it. */
export interface NotificationView {
  id: string;
  reason: NotificationReason;
  /** The sentence, to the reader; who and what are marked. */
  parts: Part[];
  /** What it quotes: a comment as it reads now, or an agent's closing note. */
  snippet: string | null;
  /** The list it happened in, when the reader can open it, to show and link to. */
  list?: Part["list"];
  /** Where it happened: the list, or the Space for a Space invite. */
  title: string;
  /** Where tapping it goes, a path in the app. */
  url: string;
  /** The ref of the item it's about, such as "SID-42", for ⌘. to copy. */
  itemRef?: string;
  createdAt: number;
  readAt: number | null;
  /** Who made the change; null when their account is gone. */
  actor: {
    userId: string;
    name: string | null;
    displayUsername: string | null;
    email: string | null;
    image: string | null;
  } | null;
  /** The agent that made it for them. */
  agentName: string | null;
  /** For an invite: who was invited (null: the reader) and to where, so a
   * push about one invite to several places or people can say it once. */
  invite?: { who: string | null; place: string };
}

const INBOX_SIZE = 30;
// Unseen ones all show, however old, up to this many, so the count and
// Mark all seen always match what's listed.
const UNSEEN_MAX = 200;
// How far back to read for seen ones the reader can still open.
const PAGES_MAX = 10;

type Recipient = { userId: string; reason: NotificationReason };

/**
 * The parent `itemId` is the last open sub-item of, now it's done: the parent
 * completeItem is about to complete with it.
 */
function finishedParent(db: Db, itemId: string): string | null {
  const parentId = db
    .select({ parentId: items.parentId })
    .from(items)
    .where(eq(items.id, itemId))
    .get()?.parentId;
  if (!parentId) return null;
  const parentOpen = db
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.id, parentId), isNull(items.completedAt)))
    .get();
  const siblingOpen = db
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.parentId, parentId), isNull(items.completedAt)))
    .get();
  return parentOpen && !siblingOpen ? parentId : null;
}

/**
 * Whether a smart due date's move asks for attention: it got a date, or one
 * sooner than before. A later date, or none, can wait to be noticed.
 */
function movedEarlier(due: DueAt, was: DueAt): boolean {
  if (!due.dueDate) return false;
  return !was.dueDate || due.dueDate < (was.dueFrom ?? was.dueDate);
}

/** Who `event` concerns and why, before the checks every rule shares. */
function rule(
  db: Db,
  event: ChangeEvent,
  actor: string,
): { to: Recipient[]; groupKey: string; projectId?: string; spaceId?: string; itemId?: string } | null {
  const as = (reason: NotificationReason, userIds: string[]): Recipient[] =>
    userIds.map((userId) => ({ userId, reason }));
  const onItem = (itemId: string, projectId: string, to: Recipient[]) => ({
    to,
    groupKey: `item:${itemId}`,
    projectId,
    itemId,
  });
  const followers = (itemId: string) => as("following", followersOf(db, itemId));
  // Who hears that someone was invited to or joined a list or Space:
  // everyone on it who can comment or more. Viewers only look on.
  const listPeople = (projectId: string) =>
    listMemberIds(db, projectId).filter((u) => listAccess(db, u, projectId) !== "view");
  const spacePeople = (spaceId: string) =>
    db
      .select({ userId: spaceMembers.userId })
      .from(spaceMembers)
      .where(
        and(
          eq(spaceMembers.spaceId, spaceId),
          eq(spaceMembers.status, "accepted"),
          inArray(spaceMembers.role, ["admin", "member", "commenter"]),
        ),
      )
      .all()
      .map((r) => r.userId);
  switch (event.type) {
    case "item.created": {
      const assignees = event.assignees.map((a) => a.userId);
      // Its creator and assignees follow it.
      autoFollow(db, event.itemId, [actor, ...assignees]);
      // Logged as already done, it asks nothing of anyone.
      const done = db
        .select({ completedAt: items.completedAt })
        .from(items)
        .where(eq(items.id, event.itemId))
        .get()?.completedAt;
      return onItem(event.itemId, event.projectId, [
        ...(done ? [] : as("assigned", assignees)),
        // A sub-item added later is news to its parent's followers; lines
        // added with the parent come with its own notification.
        ...(event.parent && !event.withParent && !done ? followers(event.itemId) : []),
        // A new item is news to everyone on the list.
        ...(event.parent || done ? [] : as("activity", listMemberIds(db, event.projectId))),
      ]);
    }
    case "item.updated": {
      const c = event.changes;
      const added = c.assignees?.added.map((a) => a.userId) ?? [];
      autoFollow(db, event.itemId, added);
      return onItem(event.itemId, event.projectId, [
        ...as("assigned", added),
        ...as("unassigned", c.assignees?.removed.map((a) => a.userId) ?? []),
        ...(c.due && (!c.smartDue || movedEarlier(c.due, c.smartDue.was)) ? followers(event.itemId) : []),
        // Reworded: worth knowing, not worth a buzz unless they asked.
        ...(c.title || c.description
          ? followersOf(db, event.itemId).map((userId) => ({ userId, reason: "activity" as const }))
          : []),
      ]);
    }
    case "item.completed": {
      // Sub-items ticked with their parent are told as the parent, and an
      // item logged as already done asks nothing of anyone.
      if (event.with?.as === "parent" || event.added) return null;
      // Ticking a parent's last open sub-item completes the parent next:
      // its followers hear that, not this too.
      const parent = finishedParent(db, event.itemId);
      const told = new Set(parent ? followersOf(db, parent) : []);
      return onItem(
        event.itemId,
        event.projectId,
        followers(event.itemId).filter((r) => !told.has(r.userId)),
      );
    }
    case "item.reopened": {
      // Likewise a parent reopened for a sub-item, or a sub-item with its parent.
      if (event.forSubItem || event.with) return null;
      // Come round again by its repeat rule, it's news only when it's due,
      // which a due reminder says (reminders.ts).
      if (event.repeat) return null;
      return onItem(event.itemId, event.projectId, followers(event.itemId));
    }
    case "item.moved":
      // Once, on the side it arrived in; sub-items go with their parent.
      return event.side === "in" && !event.with
        ? onItem(event.itemId, event.projectId, followers(event.itemId))
        : null;
    case "agent.requested":
      return onItem(event.itemId, event.projectId, followers(event.itemId));
    case "item.pr.linked":
      return onItem(
        event.itemId,
        event.projectId,
        as("activity", followersOf(db, event.itemId)),
      );
    case "comment.created": {
      // Only those who can see the item: one shown part of the list
      // mustn't follow, or hear of, an item they can't see.
      const mentioned = (event.mentioned ?? [])
        .map((p) => p.userId)
        .filter((u) => canSeeItem(db, u, event.item.itemId, event.projectId));
      autoFollow(db, event.item.itemId, [actor, ...mentioned]);
      return onItem(event.item.itemId, event.projectId, [
        ...as("mentioned", mentioned),
        ...followers(event.item.itemId),
      ]);
    }
    case "comment.edited": {
      // Only those who can see the item: one shown part of the list
      // mustn't follow, or hear of, an item they can't see.
      const mentioned = (event.mentioned ?? [])
        .map((p) => p.userId)
        .filter((u) => canSeeItem(db, u, event.item.itemId, event.projectId));
      autoFollow(db, event.item.itemId, mentioned);
      return onItem(event.item.itemId, event.projectId, as("mentioned", mentioned));
    }
    case "member.invited":
      return {
        // The invitee can't open it yet; the rest are told who's coming.
        to: [...as("invited", [event.member.userId]), ...as("joined", listPeople(event.projectId))],
        // One invite to several places or people is told as one.
        groupKey: event.inviteId ? `invite:${event.inviteId}` : `list:${event.projectId}`,
        projectId: event.projectId,
      };
    case "member.joined":
      return {
        to: as("joined", listPeople(event.projectId)),
        groupKey: `list:${event.projectId}`,
        projectId: event.projectId,
      };
    case "list.updated": {
      const { name, status } = event.changes;
      if (!name && !status) return null;
      const members = listMemberIds(db, event.projectId);
      return {
        // Archived or restored is news to everyone on it; a rename, activity.
        to: [...as("member", status ? members : []), ...as("activity", name ? members : [])],
        groupKey: `list:${event.projectId}`,
        projectId: event.projectId,
      };
    }
    case "list.deleted":
      // Told though they can't open it any more: that's the news.
      return { to: as("member", event.members ?? []), groupKey: `list:${event.projectId}` };
    case "space.deleted":
      return { to: as("member", event.members ?? []), groupKey: `space:${event.spaceId}` };
    case "list.created":
      // A list added to a Space is news to the Space.
      return event.space
        ? {
            to: as("activity", listMemberIds(db, event.projectId)),
            groupKey: `list:${event.projectId}`,
            projectId: event.projectId,
          }
        : null;
    case "space.member.invited":
      return {
        to: [
          ...as("invited", [event.member.userId]),
          ...as("joined", spacePeople(event.space.spaceId)),
        ],
        groupKey: event.inviteId ? `invite:${event.inviteId}` : `space:${event.space.spaceId}`,
        spaceId: event.space.spaceId,
      };
    case "space.member.joined":
      return {
        to: as("joined", spacePeople(event.space.spaceId)),
        groupKey: `space:${event.space.spaceId}`,
        spaceId: event.space.spaceId,
      };
    case "member.role":
      return {
        to: as("role", [event.member.userId]),
        groupKey: `list:${event.projectId}`,
        projectId: event.projectId,
      };
    case "space.member.role":
      return {
        to: as("role", [event.member.userId]),
        groupKey: `space:${event.space.spaceId}`,
        spaceId: event.space.spaceId,
      };
    case "agent.finished":
      // The agent's owner: it was working for them.
      return onItem(event.itemId, event.projectId, as("agent-finished", [actor]));
    default:
      return null;
  }
}

/**
 * Write a notification for each person `event` concerns, in the change's
 * transaction (recordAudit calls this). Nobody hears about their own
 * change, except from their agent, and then only what's for them (it
 * finished, or assigned or mentioned them): an agent acting with their API
 * key is working for them, so the rest is their own doing. What other
 * people's agents, GitHub and Sidetrack itself do is heard at the level set
 * for "agents" (agentLevel). Only people who can open the list, or are in
 * the Space, hear about something in it; an invitee is told before they can.
 */
// audit-exempt: derived from the audit row written in this transaction.
export function writeNotifications(
  db: Db,
  change: {
    auditId: string;
    ts: number;
    actor: string;
    source: AuditSource;
    agent: string | null;
    event: ChangeEvent;
  },
): string[] {
  const r = rule(db, change.event, change.actor);
  if (!r) return [];
  // One each, for the strongest reason (NOTIFICATION_REASONS is in order).
  const strength = (reason: NotificationReason) => NOTIFICATION_REASONS.indexOf(reason);
  const best = new Map<string, NotificationReason>();
  for (const { userId, reason } of r.to) {
    const had = best.get(userId);
    if (!had || strength(reason) < strength(had)) best.set(userId, reason);
  }
  const { projectId, spaceId, itemId } = r;
  // An invitee is told before they can open the place they're invited to.
  const to = [...best].filter(
    ([u, reason]) =>
      (u !== change.actor || (change.agent !== null && tierOf(reason) === "direct")) &&
      (reason === "invited" ||
        !projectId ||
        db
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, projectId), hasProjectAccess(u)))
          .get()) &&
      // Someone shown only part of the list hears only of what they see.
      (reason === "invited" || !itemId || !projectId || canSeeItem(db, u, itemId, projectId)) &&
      (reason === "invited" || !spaceId || inSpace(db, u, spaceId)),
  );
  // Each at the level they chose for where it happened.
  const space =
    spaceId ??
    (projectId
      ? db.select({ spaceId: projects.spaceId }).from(projects).where(eq(projects.id, projectId)).get()
          ?.spaceId
      : null) ??
    null;
  const rows = to.flatMap(([userId, reason]) => {
    const level = levelFor(db, userId, projectId ?? null, space);
    const tier = tierOf(reason);
    if (level === "mine" && tier !== "direct") return [];
    // Not a person: heard as they chose for agents. What's for them always is.
    const bot = change.source !== "web" && tier !== "direct" ? agentLevel(db, userId) : "all";
    if (bot === "mine") return [];
    return [
      {
        id: nanoid(12),
        userId,
        reason,
        auditId: change.auditId,
        // Activity is told list by list ("Sam made 4 changes in Groceries"),
        // the rest item by item.
        groupKey: tier === "ambient" && projectId ? `list:${projectId}` : r.groupKey,
        createdAt: change.ts,
        // Activity is pushed only to those who asked for all of it; the rest
        // see it in the inbox. Marked sent, so the sender passes it by.
        // So is the rest of what agents do, for those who keep it there.
        sentAt: (tier === "ambient" && level !== "all") || bot === "default" ? change.ts : null,
      },
    ];
  });
  if (rows.length === 0) return [];
  db.insert(notifications).values(rows).run();
  return rows.map((n) => n.userId);
}

/** How directly a reason concerns its recipient. */
export function tierOf(reason: NotificationReason): "direct" | "involved" | "ambient" {
  switch (reason) {
    case "assigned":
    case "mentioned":
    case "invited":
    case "agent-finished":
    case "due-today":
    case "overdue":
      return "direct";
    case "activity":
      return "ambient";
    default:
      return "involved";
  }
}


/**
 * `userId`'s level for a list (or a Space, with no list): the list's own,
 * else its Space's, else theirs for everything, else "default".
 */
function levelFor(
  db: Db,
  userId: string,
  projectId: string | null,
  spaceId: string | null,
): NotificationLevel {
  const scopes = [
    ...(projectId ? [`list:${projectId}`] : []),
    ...(spaceId ? [`space:${spaceId}`] : []),
    "all",
  ];
  const set = new Map(
    db
      .select({ scope: notificationSettings.scope, level: notificationSettings.level })
      .from(notificationSettings)
      .where(and(eq(notificationSettings.userId, userId), inArray(notificationSettings.scope, scopes)))
      .all()
      .map((r) => [r.scope, r.level]),
  );
  return scopes.map((scope) => set.get(scope)).find(Boolean) ?? "default";
}

/**
 * How `userId` hears what isn't a person's doing (other people's agents,
 * GitHub, Sidetrack itself): "all" like people, "default" (also with
 * nothing set) in the inbox only, "mine" only what's for them.
 */
function agentLevel(db: Db, userId: string): NotificationLevel {
  return (
    db
      .select({ level: notificationSettings.level })
      .from(notificationSettings)
      .where(and(eq(notificationSettings.userId, userId), eq(notificationSettings.scope, "agents")))
      .get()?.level ?? "default"
  );
}

/** The levels `userId` has set, by scope ("all", "space:<id>", "list:<id>"). */
export function listNotificationLevels(db: Db, userId: string): Record<string, NotificationLevel> {
  return Object.fromEntries(
    db
      .select({ scope: notificationSettings.scope, level: notificationSettings.level })
      .from(notificationSettings)
      .where(eq(notificationSettings.userId, userId))
      .all()
      .map((r) => [r.scope, r.level]),
  );
}

/**
 * Set how much `userId` hears about a scope: "all" (everything), or a Space
 * or list they're in. null goes back to what it inherits. Not audited,
 * like following: it's this person's, and changes nothing anyone else sees.
 */
export function setNotificationLevel(
  db: Db,
  userId: string,
  scope: string,
  level: NotificationLevel | null,
): void {
  const [kind, id] = scope.split(":");
  const reachable =
    scope === "all" ||
    scope === "reminders" ||
    scope === "agents" ||
    (kind === "list" &&
      id &&
      db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, id), hasProjectAccess(userId)))
        .get()) ||
    (kind === "space" && id && inSpace(db, userId, id));
  if (!reachable) throw new Error(`not found: ${scope}`);
  if (level !== null && !(NOTIFICATION_LEVELS as readonly string[]).includes(level)) {
    throw new Error(`unknown notification level: ${level}`);
  }
  const where = and(eq(notificationSettings.userId, userId), eq(notificationSettings.scope, scope));
  if (level === null) {
    // audit-exempt: a personal preference, seen by nobody else.
    db.delete(notificationSettings).where(where).run();
    return;
  }
  const updatedAt = Date.now();
  // audit-exempt: a personal preference, seen by nobody else.
  db.insert(notificationSettings)
    .values({ userId, scope, level, updatedAt })
    .onConflictDoUpdate({
      target: [notificationSettings.userId, notificationSettings.scope],
      set: { level, updatedAt },
    })
    .run();
}

function inSpace(db: Db, userId: string, spaceId: string): boolean {
  return Boolean(
    db
      .select({ id: spaceMembers.id })
      .from(spaceMembers)
      .where(
        and(
          eq(spaceMembers.spaceId, spaceId),
          eq(spaceMembers.userId, userId),
          eq(spaceMembers.status, "accepted"),
        ),
      )
      .get(),
  );
}

type Row = {
  id: string;
  userId: string;
  groupKey: string;
  reason: NotificationReason;
  createdAt: number;
  readAt: number | null;
  /** A due reminder's item; it has no change, so no event or actor. */
  itemId: string | null;
  event: ChangeEvent | null;
  agentName: string | null;
  actorId: string | null;
  actor: NotificationView["actor"];
};

function selectRows(db: Db) {
  return db
    .select({
      id: notifications.id,
      userId: notifications.userId,
      groupKey: notifications.groupKey,
      reason: notifications.reason,
      createdAt: notifications.createdAt,
      readAt: notifications.readAt,
      itemId: notifications.itemId,
      event: auditLog.event,
      agentName: auditLog.agentName,
      actorId: auditLog.actor,
      actor: {
        userId: users.id,
        name: users.name,
        displayUsername: users.displayUsername,
        email: users.email,
        image: users.image,
      },
    })
    .from(notifications)
    // Left: a due reminder has no audit row.
    .leftJoin(auditLog, eq(auditLog.id, notifications.auditId))
    // Left: a deleted actor's notifications still show, without a face.
    .leftJoin(users, eq(users.id, auditLog.actor));
}

/** A list the reader can open, by name, with its icon, to link to. */
function listPart(
  id: string,
  name: string,
  look: { icon: string | null; homepageUrl: string | null },
): Part {
  return { text: name, em: "place", quote: true, list: { id, icon: look.icon, homepageUrl: look.homepageUrl } };
}

/** The item a notification is about, if any. */
function itemOf(event: ChangeEvent): ItemAt | null {
  switch (event.type) {
    case "item.created":
    case "item.updated":
    case "item.completed":
    case "item.reopened":
    case "item.moved":
    case "agent.requested":
    case "agent.finished":
    case "item.pr.linked":
      return event;
    case "comment.created":
    case "comment.edited":
      return event.item;
    default:
      return null;
  }
}

/** A comment or note on one line, short enough for a notification. */
function excerpt(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
}

/**
 * `rows`, all `userId`'s, said to them. One about an item shows only while
 * they can open the item, by its current title, in its current list.
 */
function describe(db: Db, userId: string, rows: Row[]): NotificationView[] {
  const events = rows.flatMap((r) => (r.event ? [r.event] : []));
  const itemIds = [
    ...new Set([
      ...events.flatMap((e) => itemOf(e)?.itemId ?? []),
      // A sub-item's parent, to show whether it's done.
      ...events.flatMap((e) => (e.type === "item.created" && e.parent ? [e.parent.itemId] : [])),
      ...rows.flatMap((r) => r.itemId ?? []),
    ]),
  ];
  const open = new Map(
    (itemIds.length
      ? db
          .select({
            id: items.id,
            title: items.title,
            number: items.number,
            projectId: items.projectId,
            completedAt: items.completedAt,
            prefix: projects.prefix,
            list: projects.name,
            icon: projects.icon,
            homepageUrl: projects.homepageUrl,
          })
          .from(items)
          .innerJoin(projects, eq(projects.id, items.projectId))
          .where(and(inArray(items.id, itemIds), hasItemAccess(userId)))
          .all()
      : []
    ).map((r) => [r.id, r]),
  );
  const commentIds = events.flatMap((e) =>
    e.type === "comment.created" || e.type === "comment.edited" ? [e.commentId] : [],
  );
  const bodies = new Map(
    (commentIds.length
      ? db
          .select({ id: comments.id, body: comments.body })
          .from(comments)
          .where(inArray(comments.id, commentIds))
          .all()
      : []
    ).map((c) => [c.id, c.body]),
  );

  const listIds = [
    ...new Set(
      events.flatMap((e) =>
        e.type === "member.joined" ||
        e.type === "member.invited" ||
        e.type === "member.role" ||
        e.type === "list.updated" ||
        e.type === "list.created"
          ? [e.projectId]
          : [],
      ),
    ),
  ];
  const lists = new Map(
    (listIds.length
      ? db
          .select({
            id: projects.id,
            name: projects.name,
            icon: projects.icon,
            homepageUrl: projects.homepageUrl,
            space: spaces.name,
          })
          .from(projects)
          .leftJoin(spaces, eq(spaces.id, projects.spaceId))
          .where(and(inArray(projects.id, listIds), hasProjectAccess(userId)))
          .all()
      : []
    ).map((p) => [p.id, p]),
  );
  const spaceIds = [
    ...new Set(
      events.flatMap((e) =>
        e.type === "space.member.joined" ||
        e.type === "space.member.invited" ||
        e.type === "space.member.role"
          ? [e.space.spaceId]
          : [],
      ),
    ),
  ];
  const spaceNames = new Map(
    (spaceIds.length
      ? db
          .select({ id: spaces.id, name: spaces.name })
          .from(spaces)
          .innerJoin(spaceMembers, eq(spaceMembers.spaceId, spaces.id))
          .where(
            and(
              inArray(spaces.id, spaceIds),
              eq(spaceMembers.userId, userId),
              eq(spaceMembers.status, "accepted"),
            ),
          )
          .all()
      : []
    ).map((sp) => [sp.id, sp.name]),
  );

  // Invites still standing, pending or taken up: one revoked or declined (or
  // left since) goes from everyone's inbox, the invitee's too.
  const inviteIds = (type: "member.invited" | "space.member.invited") =>
    events.flatMap((e) => (e.type === type ? [e.membershipId] : []));
  const listInvites = inviteIds("member.invited");
  const spaceInvites = inviteIds("space.member.invited");
  const standing = new Set([
    ...(listInvites.length
      ? db
          .select({ id: projectMembers.id })
          .from(projectMembers)
          .where(inArray(projectMembers.id, listInvites))
          .all()
      : []),
    ...(spaceInvites.length
      ? db
          .select({ id: spaceMembers.id })
          .from(spaceMembers)
          .where(inArray(spaceMembers.id, spaceInvites))
          .all()
      : []),
  ].map((m) => m.id));

  return rows.flatMap((r): NotificationView[] => {
    // A due reminder: the item as it is now, while they can open it.
    if (r.reason === "due-today" || r.reason === "overdue") {
      const now = r.itemId ? open.get(r.itemId) : undefined;
      if (!now) return [];
      return [
        {
          id: r.id,
          reason: r.reason,
          createdAt: r.createdAt,
          readAt: r.readAt,
          actor: null,
          agentName: null,
          title: now.list,
          list: listPart(now.projectId, now.list, now).list,
          url: `/board?p=${encodeURIComponent(now.projectId)}&item=${encodeURIComponent(now.id)}`,
          itemRef: formatItemRef(now.prefix, now.number),
          parts: [
            { text: now.title, em: "item", quote: true },
            { text: r.reason === "due-today" ? " is due today" : " is overdue" },
          ],
          snippet: null,
        },
      ];
    }
    const event = r.event;
    if (!event) return [];
    const a = r.actor;
    const who: Part = {
      text:
        r.agentName ??
        (r.actorId === SYSTEM_ACTOR
          ? "Sidetrack"
          : a?.name || (a?.displayUsername ? `@${a.displayUsername}` : a?.email) || "Someone"),
      em: "person",
    };
    // Whoever joined, even through their agent: it's them on the list now.
    const person: Part = {
      text: a?.name || (a?.displayUsername ? `@${a.displayUsername}` : a?.email) || "Someone",
      em: "person",
    };
    const t = (text: string): Part => ({ text });
    const base = {
      id: r.id,
      reason: r.reason,
      createdAt: r.createdAt,
      readAt: r.readAt,
      actor: a?.userId ? a : null,
      agentName: r.agentName,
    };
    const about = itemOf(event);
    if (about) {
      const now = open.get(about.itemId);
      if (!now) return [];
      const item: Part = { text: now.title, em: "item", quote: true, ...(now.completedAt !== null && { done: true }) };
      const at = {
        title: now.list,
        list: listPart(now.projectId, now.list, now).list,
        url: `/board?p=${encodeURIComponent(now.projectId)}&item=${encodeURIComponent(now.id)}`,
        itemRef: formatItemRef(now.prefix, now.number),
      };
      const say = (parts: Part[], snippet: string | null = null): NotificationView[] => [
        { ...base, ...at, parts, snippet },
      ];
      switch (event.type) {
        case "item.created":
          return r.reason === "assigned"
            ? say([who, t(" added "), item, t(" for you")])
            : event.parent
              ? say([
                  who,
                  t(" added "),
                  item,
                  t(" to "),
                  {
                    text: event.parent.title,
                    em: "item",
                    quote: true,
                    ...(open.get(event.parent.itemId)?.completedAt != null && { done: true }),
                  },
                ])
              : say([who, t(" added "), item, t(" to "), listPart(now.projectId, now.list, now)]);
        case "item.updated":
          if (r.reason === "assigned") return say([who, t(" assigned you "), item]);
          if (r.reason === "unassigned") return say([who, t(" took you off "), item]);
          if (r.reason === "activity") return say([who, t(" edited "), item]);
          if (r.actorId === SYSTEM_ACTOR && event.changes.smartDue && event.changes.due?.dueDate) {
            return say([item, t(" is now due "), duePart({ ...event.changes.due, dueDate: event.changes.due.dueDate })]);
          }
          return event.changes.due?.dueDate
            ? say([who, t(" set "), item, t(" due "), duePart({ ...event.changes.due, dueDate: event.changes.due.dueDate })])
            : say([who, t(" cleared the due date on "), item]);
        case "item.completed":
          return say([who, t(" completed "), item]);
        case "item.reopened":
          return event.repeat
            ? say([item, t(" is due again")])
            : say([who, t(" reopened "), item]);
        case "item.moved":
          return say([who, t(" moved "), item, t(" to "), listPart(now.projectId, now.list, now)]);
        case "agent.requested":
          return say([who, t(" asked "), { text: event.agent, em: "person" }, t(" to work on "), item]);
        case "item.pr.linked":
          return say([who, t(" linked a pull request to "), item]);
        case "comment.created":
        case "comment.edited": {
          const body = bodies.get(event.commentId);
          return say(
            r.reason === "mentioned"
              ? [who, t(" mentioned you on "), item]
              : [who, t(" commented on "), item],
            body ? excerpt(body) : null,
          );
        }
        case "agent.finished":
          return [
            {
              ...base,
              ...at,
              parts: [who, t(" finished work on "), item],
              snippet: event.note ? excerpt(event.note) : null,
            },
          ];
      }
    }
    if (
      (event.type === "member.invited" || event.type === "space.member.invited") &&
      !standing.has(event.membershipId)
    ) {
      return [];
    }
    // What someone joined or was invited as, when it's less than editing.
    // and whose items they see, when it's only someone's.
    const whose = (only: PersonAt) => (only.userId === r.userId ? "your" : `${only.name}'s`);
    const asRole = (role: ListRole | SpaceRole | undefined, only?: PersonAt): Part[] =>
      role && role !== "editor" && role !== "member"
        ? [t(` as ${roleWords(role)}${only ? ` of ${whose(only)} items` : ""}`)]
        : [];
    // Someone else invited: told to those already in the list or Space, by
    // its current name, while they still are.
    if (
      (event.type === "member.invited" || event.type === "space.member.invited") &&
      r.reason !== "invited"
    ) {
      const list = event.type === "member.invited" ? lists.get(event.projectId) : undefined;
      const name =
        event.type === "member.invited" ? list?.name : spaceNames.get(event.space.spaceId);
      if (!name) return [];
      const place: Part =
        event.type === "member.invited" && list
          ? listPart(event.projectId, name, list)
          : { text: name, em: "place", quote: true };
      return [
        {
          ...base,
          title: name,
          list: place.list,
          url: event.type === "member.invited" ? `/board?p=${encodeURIComponent(event.projectId)}` : "/",
          invite: { who: event.member.name, place: name },
          parts: [
            who,
            t(" invited "),
            { text: event.member.name, em: "person" },
            t(" to "),
            place,
            ...asRole(event.role, event.onlyAssignedTo),
          ],
          snippet: null,
        },
      ];
    }
    // Invites: named as they were sent, since the invitee can't see the list
    // or Space (or any rename of it) until they join. The board shows the
    // invite to accept.
    if (event.type === "member.invited" || event.type === "space.member.invited") {
      const name = event.type === "member.invited" ? event.listName : event.space.name;
      return [
        {
          ...base,
          title: name,
          url: "/",
          invite: { who: null, place: name },
          parts: [
            who,
            t(" invited you to "),
            { text: name, em: "place", quote: true },
            ...asRole(event.role, event.onlyAssignedTo),
          ],
          snippet: null,
        },
      ];
    }
    // Deleted: by the name it had, since it's gone; they were in it when it went.
    if (event.type === "list.deleted" || event.type === "space.deleted") {
      const name = event.type === "list.deleted" ? event.listName : event.name;
      return [
        {
          ...base,
          title: name,
          url: "/",
          parts: [who, t(" deleted "), { text: name, em: "place", quote: true }],
          snippet: null,
        },
      ];
    }
    // Joins and roles: only while the reader is still in the list or Space,
    // by its current name.
    if (event.type === "member.role") {
      const list = lists.get(event.projectId);
      if (!list) return [];
      const place = listPart(event.projectId, list.name, list);
      return [
        {
          ...base,
          title: list.name,
          list: place.list,
          url: `/board?p=${encodeURIComponent(event.projectId)}`,
          parts: [
            who,
            t(` made you ${roleWords(event.role)} of `),
            place,
            ...(event.onlyAssignedTo ? [t(`, seeing only ${whose(event.onlyAssignedTo)} items`)] : []),
            ...(event.seesAll ? [t(", seeing all of it")] : []),
          ],
          snippet: null,
        },
      ];
    }
    if (event.type === "member.joined" || event.type === "list.updated" || event.type === "list.created") {
      const list = lists.get(event.projectId);
      if (!list) return [];
      const name = list.name;
      const place = listPart(event.projectId, name, list);
      const status = event.type === "list.updated" && r.reason === "member" ? event.changes.status : null;
      const parts: Part[] =
        status
          ? [who, t(status.to === "archived" ? " archived " : " restored "), place]
          : event.type === "list.updated"
          ? [who, t(" renamed "), { text: event.changes.name?.from ?? "", em: "place", quote: true }, t(" to "), place]
          : event.type === "list.created"
            ? list.space
              ? [who, t(" added "), place, t(" to "), { text: list.space, em: "place", quote: true }]
              : [who, t(" added "), place]
            : [person, t(" joined "), place, ...(event.type === "member.joined" ? asRole(event.role, event.onlyAssignedTo) : [])];
      return [
        {
          ...base,
          title: name,
          list: place.list,
          // An archived list shows in the Archived view, not on the board.
          url: status?.to === "archived" ? "/archived" : `/board?p=${encodeURIComponent(event.projectId)}`,
          parts,
          snippet: null,
        },
      ];
    }
    if (event.type === "space.member.joined" || event.type === "space.member.role") {
      const name = spaceNames.get(event.space.spaceId);
      if (!name) return [];
      const space: Part = { text: name, em: "place", quote: true };
      return [
        {
          ...base,
          title: name,
          url: "/",
          parts:
            event.type === "space.member.role"
              ? [
                  who,
                  t(` made you ${roleWords(event.role)} of `),
                  space,
                  ...(event.onlyAssignedTo ? [t(`, seeing only ${whose(event.onlyAssignedTo)} items`)] : []),
                  ...(event.seesAll ? [t(", seeing all of it")] : []),
                ]
              : [person, t(" joined "), space, ...asRole(event.role, event.onlyAssignedTo)],
          snippet: null,
        },
      ];
    }
    return [];
  });
}

/**
 * The user's notifications, newest first: every unseen one, and their
 * latest INBOX_SIZE they can still open. Ones they can't are dropped after
 * reading, so it reads on, a page at a time, until the inbox is full.
 */
export function listNotifications(db: Db, userId: string): NotificationView[] {
  // rowid breaks ties between ones made in the same millisecond, latest
  // first; the id is random, so it would shuffle them.
  const order = [desc(notifications.createdAt), desc(sql`${notifications}.rowid`)];
  const unseen = describe(
    db,
    userId,
    selectRows(db)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
      .orderBy(...order)
      .limit(UNSEEN_MAX)
      .all(),
  );
  const seen: NotificationView[] = [];
  for (let page = 0; seen.length < INBOX_SIZE && page < PAGES_MAX; page++) {
    const rows = selectRows(db)
      .where(and(eq(notifications.userId, userId), isNotNull(notifications.readAt)))
      .orderBy(...order)
      .limit(INBOX_SIZE)
      .offset(page * INBOX_SIZE)
      .all();
    seen.push(...describe(db, userId, rows));
    if (rows.length < INBOX_SIZE) break;
  }
  // A stable sort, so ties keep the order the queries gave them.
  return [...unseen, ...seen.slice(0, INBOX_SIZE)].sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Mark the user's notifications `ids` seen, or all of them. Not audited,
 * like folding the Agenda's Overdue: it's what this person has seen, not a
 * change to anything.
 */
// audit-exempt: read state, seen by nobody else.
export function markNotificationsRead(db: Db, userId: string, ids?: string[]): void {
  db.update(notifications)
    .set({ readAt: Date.now() })
    .where(
      and(
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
        ids ? inArray(notifications.id, ids) : undefined,
      ),
    )
    .run();
}

// A group (one person, one item or list) is pushed once it has been quiet
// this long, so a burst of changes is one push: briefly for something aimed
// at them, longer for the rest. However busy, it waits no longer than
// MAX_WAIT_MS from its first change.
const QUIET_DIRECT_MS = 30_000;
const QUIET_MS = 2 * 60_000;
const MAX_WAIT_MS = 5 * 60_000;
// Older than this when its turn comes (say the server stopped before sending
// it), a push is news nobody needs any more: it stays in the inbox only.
const PUSH_FRESH_MS = 10 * 60_000;
// How often to look for due reminders to write: within this of 8am.
const REMIND_EVERY_MS = 15 * 60_000;

/**
 * Push what's due: each person's unsent notifications about one item (or,
 * for activity, one list) once that group has been quiet a while, as one
 * push, worded as it's sent. A change undone within the group, such as a
 * tick then an untick, cancels out. Someone looking at their board gets no
 * push: the group goes to their inbox, seen. Each row is claimed (sentAt
 * set) before any await, so runs that overlap never send one twice; one
 * whose push fails stays claimed and in the inbox. Pushes nothing without
 * VAPID keys. Returns when the next waiting group is due, or null.
 */
export async function deliverNotifications(db: Db, now = Date.now()): Promise<number | null> {
  const unsent = db
    .select({
      id: notifications.id,
      userId: notifications.userId,
      groupKey: notifications.groupKey,
      reason: notifications.reason,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(isNull(notifications.sentAt))
    .all();
  const groups = new Map<string, typeof unsent>();
  for (const n of unsent) {
    const key = `${n.userId} ${n.groupKey}`;
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }
  let next: number | null = null;
  const dueIds: string[] = [];
  for (const group of groups.values()) {
    const times = group.map((n) => n.createdAt);
    const quiet = group.some((n) => tierOf(n.reason) === "direct") ? QUIET_DIRECT_MS : QUIET_MS;
    const at = Math.min(Math.max(...times) + quiet, Math.min(...times) + MAX_WAIT_MS);
    if (at <= now) dueIds.push(...group.map((n) => n.id));
    else next = Math.min(next ?? at, at);
  }
  if (dueIds.length === 0) return next;
  // Only rows still unsent, so another run that read the same ones sends
  // only what it claimed.
  // audit-exempt: delivery bookkeeping on derived rows.
  const claimed = db
    .update(notifications)
    .set({ sentAt: now })
    .where(and(inArray(notifications.id, dueIds), isNull(notifications.sentAt)))
    .returning({ id: notifications.id })
    .all()
    .map((r) => r.id);
  if (claimed.length === 0) return next;
  const rows = selectRows(db).where(inArray(notifications.id, claimed)).all();
  const byGroup = new Map<string, Row[]>();
  for (const r of rows.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))) {
    const key = `${r.userId} ${r.groupKey}`;
    byGroup.set(key, [...(byGroup.get(key) ?? []), r]);
  }
  const vapid = getEnv().VAPID;
  // Each recipient's day, so a push says when things are due in words.
  const recipients = [...new Set(rows.map((r) => r.userId))];
  const zones = new Map(
    db
      .select({ id: users.id, timeZone: users.timeZone })
      .from(users)
      .where(inArray(users.id, recipients))
      .all()
      .map((u) => [u.id, u.timeZone ?? "UTC"]),
  );
  const seen: string[] = [];
  const pushes: Array<{ userId: string; message: PushMessage }> = [];
  for (const group of byGroup.values()) {
    const userId = group[0].userId;
    // On screen: the board shows it already.
    if (isLooking(userId)) {
      seen.push(...group.map((r) => r.id));
      continue;
    }
    const { kept, undone } = cancelUndone(group);
    seen.push(...undone);
    const views = describe(db, userId, kept);
    if (views.length === 0 || views[views.length - 1].createdAt <= now - PUSH_FRESH_MS) continue;
    const today = dayOf(now, zones.get(userId) ?? "UTC");
    pushes.push({ userId, message: { ...summarise(views, today), tag: group[0].groupKey } });
  }
  if (seen.length) {
    // audit-exempt: read state on derived rows, seen by nobody else.
    db.update(notifications)
      .set({ readAt: now })
      .where(and(inArray(notifications.id, seen), isNull(notifications.readAt)))
      .run();
  }
  if (!vapid) return next;
  await Promise.all(
    pushes.map(async ({ userId, message }) => {
      // The app's badge: what's unseen, once this is.
      const badge = listNotifications(db, userId).filter((n) => n.readAt === null).length;
      const { gone } = await sendPush(
        pushTargets(db, userId, vapid.publicKey),
        { ...message, badge },
        vapid,
      );
      forgetPushSubscriptions(db, gone);
    }),
  );
  return next;
}

/**
 * `group` without the changes undone within it: an item ticked then
 * unticked (or the reverse), or someone assigned then taken off it (or the
 * reverse). Returns what's left, and the ids of the pairs that cancelled.
 */
function cancelUndone(group: Row[]): { kept: Row[]; undone: string[] } {
  const kept: Row[] = [];
  const undone: string[] = [];
  // What a row did, and what would undo it.
  const move = (r: Row): { did: string; undoes: string } | null => {
    const e = r.event;
    if (!e) return null;
    if (e.type === "item.completed" && !e.with) return { did: `done ${e.itemId}`, undoes: `open ${e.itemId}` };
    if (e.type === "item.reopened" && !e.with && !e.forSubItem && !e.repeat) {
      return { did: `open ${e.itemId}`, undoes: `done ${e.itemId}` };
    }
    if (e.type === "item.updated" && r.reason === "assigned") return { did: `on ${e.itemId}`, undoes: `off ${e.itemId}` };
    if (e.type === "item.updated" && r.reason === "unassigned") return { did: `off ${e.itemId}`, undoes: `on ${e.itemId}` };
    return null;
  };
  for (const r of group) {
    const m = move(r);
    const at = m ? kept.findLastIndex((k) => move(k)?.did === m.undoes) : -1;
    if (at === -1) {
      kept.push(r);
    } else {
      undone.push(kept[at].id, r.id);
      kept.splice(at, 1);
    }
  }
  return { kept, undone };
}

/** One push for a group's notifications: its sentence, or a summary of several. */
function summarise(views: NotificationView[], today: string): Omit<PushMessage, "tag"> {
  const last = views[views.length - 1];
  // A due reminder leads with the item, quoted so it stays apart from the
  // "from Sidetrack" iOS adds to the title.
  if (views.length === 1 && (last.reason === "due-today" || last.reason === "overdue")) {
    // The list's emoji, when its icon is one; an image icon can't show in a push.
    const icon = last.list?.icon && isEmoji(last.list.icon) ? `${last.list.icon} ` : "";
    return {
      title: `“${last.parts[0].text}”`,
      body: `${last.reason === "due-today" ? "Due today" : "Overdue"} • ${icon}${last.title}`,
      url: last.url,
    };
  }
  if (views.length === 1) {
    return {
      title: last.title,
      body: plainText(last.parts, today) + (last.snippet ? `: ${last.snippet}` : ""),
      url: last.url,
    };
  }
  // A morning's due reminders: what's due, by name, and the Agenda.
  if (views.every((v) => v.reason === "due-today" || v.reason === "overdue")) {
    const titles = views.map((v) => `"${v.parts[0].text}"`);
    const named =
      titles.length === 2
        ? `${titles[0]} and ${titles[1]}`
        : titles.length === 3
          ? `${titles[0]}, ${titles[1]} and ${titles[2]}`
          : `${titles[0]}, ${titles[1]} and ${titles.length - 2} more`;
    const when = views.every((v) => v.reason === "due-today")
      ? "are due today"
      : views.every((v) => v.reason === "overdue")
        ? "are overdue"
        : "are due or overdue";
    return { title: "Due", body: `${named} ${when}`, url: "/brief" };
  }
  // One invite to several places or people: said once, naming each.
  // Only when one person sent them all: a Space's other admin may have
  // invited someone else in the same window.
  const invites = views.flatMap((v) => (v.invite ? [v.invite] : []));
  if (
    invites.length === views.length &&
    new Set(views.map((v) => v.parts[0]?.text)).size === 1
  ) {
    const and = (list: string[]) =>
      list.length === 1 ? list[0] : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
    const invited = [...new Set(invites.map((i) => i.who ?? "you"))];
    const places = [...new Set(invites.map((i) => `"${i.place}"`))];
    const by = last.parts[0]?.text ?? "Someone";
    return {
      title: places.length === 1 ? last.title : "Invites",
      body: `${by} invited ${and(invited)} to ${and(places)}`,
      url: invited.includes("you") ? "/" : last.url,
    };
  }
  // Who: the person each sentence starts with, in order of first change.
  const names = [
    ...new Set(views.map((v) => (v.parts[0]?.em === "person" ? v.parts[0].text : "Sidetrack"))),
  ];
  const who =
    names.length === 1
      ? names[0]
      : names.length === 2
        ? `${names[0]} and ${names[1]}`
        : `${names[0]} and ${names.length - 1} others`;
  // An item's group names the item; a list's, the list.
  const item = last.parts.find((p) => p.em === "item");
  const sameItem = views.every((v) => v.url === last.url);
  const body =
    sameItem && item
      ? `${who} made ${views.length} changes to "${item.text}"`
      : `${who} made ${views.length} changes in "${last.title}"`;
  return { title: last.title, body, url: sameItem ? last.url : last.url.replace(/&item=[^&]*/, "") };
}

declare global {
  var __sidetrackNotificationDelivery: boolean | undefined;
}

/**
 * Push notifications as they come due: after each committed batch of
 * changes (recordAudit announces every audited change, and a notification
 * is only ever written with one), and when a group waiting to go quiet is
 * due. Started once per process, at boot.
 */
export function startNotificationDelivery(db: Db): void {
  if (globalThis.__sidetrackNotificationDelivery) return;
  globalThis.__sidetrackNotificationDelivery = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deliver = () =>
    deliverNotifications(db)
      .then((next) => {
        clearTimeout(timer);
        if (next !== null) timer = setTimeout(deliver, Math.max(next - Date.now(), 1_000));
      })
      .catch((error) => getPostHog()?.captureException(error));
  onChanges(deliver);
  // Due reminders, written as each person's morning comes, then sent.
  const remind = () => {
    try {
      if (remindDue(db) > 0) void deliver();
    } catch (error) {
      getPostHog()?.captureException(error);
    }
  };
  setInterval(remind, REMIND_EVERY_MS).unref();
  remind();
  // Whatever was committed but not sent before the last stop.
  void deliver();
}
