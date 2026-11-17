import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getEnv } from "../lib/env";
import { getPostHog } from "../lib/posthog";
import { sendPush } from "../lib/push";
import { hasProjectAccess } from "./access";
import { users } from "./auth-schema";
import { onChanges } from "./changes";
import type { Db } from "./db";
import { SYSTEM_ACTOR } from "./audit";
import { dueText, type Part, plainText } from "./describe";
import { autoFollow, followersOf } from "./follows";
import type { ChangeEvent, ItemAt } from "./events";
import { forgetPushSubscriptions, pushTargets } from "./push";
import {
  auditLog,
  comments,
  items,
  NOTIFICATION_REASONS,
  type NotificationReason,
  notifications,
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
  /** Where it happened: the list, or the Space for a Space invite. */
  title: string;
  /** Where tapping it goes, a path in the app. */
  url: string;
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

/** Who `event` concerns and why, before the checks every rule shares. */
function rule(
  db: Db,
  event: ChangeEvent,
  actor: string,
): { to: Recipient[]; groupKey: string; projectId?: string; spaceId?: string } | null {
  const as = (reason: NotificationReason, userIds: string[]): Recipient[] =>
    userIds.map((userId) => ({ userId, reason }));
  const onItem = (itemId: string, projectId: string, to: Recipient[]) => ({
    to,
    groupKey: `item:${itemId}`,
    projectId,
  });
  const followers = (itemId: string) => as("following", followersOf(db, itemId));
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
      ]);
    }
    case "item.updated": {
      const c = event.changes;
      const added = c.assignees?.added.map((a) => a.userId) ?? [];
      autoFollow(db, event.itemId, added);
      return onItem(event.itemId, event.projectId, [
        ...as("assigned", added),
        ...as("unassigned", c.assignees?.removed.map((a) => a.userId) ?? []),
        ...(c.due ? followers(event.itemId) : []),
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
      if (!event.repeat) return onItem(event.itemId, event.projectId, followers(event.itemId));
      // Come round again by its repeat rule: only whoever it's for needs telling.
      const assignees =
        db
          .select({ assigneeIds: items.assigneeIds })
          .from(items)
          .where(eq(items.id, event.itemId))
          .get()?.assigneeIds ?? [];
      return onItem(event.itemId, event.projectId, as("assigned", assignees));
    }
    case "item.moved":
      // Once, on the side it arrived in; sub-items go with their parent.
      return event.side === "in" && !event.with
        ? onItem(event.itemId, event.projectId, followers(event.itemId))
        : null;
    case "agent.requested":
      return onItem(event.itemId, event.projectId, followers(event.itemId));
    case "comment.created": {
      const mentioned = event.mentioned?.map((p) => p.userId) ?? [];
      autoFollow(db, event.item.itemId, [actor, ...mentioned]);
      return onItem(event.item.itemId, event.projectId, [
        ...as("mentioned", mentioned),
        ...followers(event.item.itemId),
      ]);
    }
    case "comment.edited": {
      const mentioned = event.mentioned?.map((p) => p.userId) ?? [];
      autoFollow(db, event.item.itemId, mentioned);
      return onItem(event.item.itemId, event.projectId, as("mentioned", mentioned));
    }
    case "member.invited":
      return { to: as("invited", [event.member.userId]), groupKey: `list:${event.projectId}` };
    case "member.joined": {
      const owner = db
        .select({ userId: projects.userId })
        .from(projects)
        .where(eq(projects.id, event.projectId))
        .get()?.userId;
      return {
        to: as("joined", owner ? [owner] : []),
        groupKey: `list:${event.projectId}`,
        projectId: event.projectId,
      };
    }
    case "space.member.invited":
      return {
        to: as("invited", [event.member.userId]),
        groupKey: `space:${event.space.spaceId}`,
      };
    case "space.member.joined": {
      const admins = db
        .select({ userId: spaceMembers.userId })
        .from(spaceMembers)
        .where(
          and(
            eq(spaceMembers.spaceId, event.space.spaceId),
            eq(spaceMembers.status, "accepted"),
            eq(spaceMembers.role, "admin"),
          ),
        )
        .all()
        .map((r) => r.userId);
      return {
        to: as("joined", admins),
        groupKey: `space:${event.space.spaceId}`,
        spaceId: event.space.spaceId,
      };
    }
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
 * change, except from their agent: an agent acting with their API key is
 * someone working for them. Only people who can open the list hear about
 * something in it.
 */
// audit-exempt: derived from the audit row written in this transaction.
export function writeNotifications(
  db: Db,
  change: { auditId: string; ts: number; actor: string; agent: string | null; event: ChangeEvent },
): void {
  const r = rule(db, change.event, change.actor);
  if (!r) return;
  // One each, for the strongest reason (NOTIFICATION_REASONS is in order).
  const strength = (reason: NotificationReason) => NOTIFICATION_REASONS.indexOf(reason);
  const best = new Map<string, NotificationReason>();
  for (const { userId, reason } of r.to) {
    const had = best.get(userId);
    if (!had || strength(reason) < strength(had)) best.set(userId, reason);
  }
  const { projectId, spaceId } = r;
  const to = [...best].filter(
    ([u]) =>
      (change.agent || u !== change.actor) &&
      (!projectId ||
        db
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, projectId), hasProjectAccess(u)))
          .get()) &&
      (!spaceId || inSpace(db, u, spaceId)),
  );
  if (to.length === 0) return;
  db.insert(notifications)
    .values(
      to.map(([userId, reason]) => ({
        id: nanoid(12),
        userId,
        reason,
        auditId: change.auditId,
        groupKey: r.groupKey,
        createdAt: change.ts,
      })),
    )
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
  reason: NotificationReason;
  createdAt: number;
  readAt: number | null;
  event: ChangeEvent | null;
  agentName: string | null;
  actorId: string;
  actor: NotificationView["actor"];
};

function selectRows(db: Db) {
  return db
    .select({
      id: notifications.id,
      reason: notifications.reason,
      createdAt: notifications.createdAt,
      readAt: notifications.readAt,
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
    .innerJoin(auditLog, eq(auditLog.id, notifications.auditId))
    // Left: a deleted actor's notifications still show, without a face.
    .leftJoin(users, eq(users.id, auditLog.actor));
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
  const itemIds = [...new Set(events.flatMap((e) => itemOf(e)?.itemId ?? []))];
  const open = new Map(
    (itemIds.length
      ? db
          .select({ id: items.id, title: items.title, projectId: items.projectId, list: projects.name })
          .from(items)
          .innerJoin(projects, eq(projects.id, items.projectId))
          .where(and(inArray(items.id, itemIds), hasProjectAccess(userId)))
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
    ...new Set(events.flatMap((e) => (e.type === "member.joined" ? [e.projectId] : []))),
  ];
  const lists = new Map(
    (listIds.length
      ? db
          .select({ id: projects.id, name: projects.name })
          .from(projects)
          .where(and(inArray(projects.id, listIds), hasProjectAccess(userId)))
          .all()
      : []
    ).map((p) => [p.id, p.name]),
  );
  const spaceIds = [
    ...new Set(
      events.flatMap((e) =>
        e.type === "space.member.joined" || e.type === "space.member.role" ? [e.space.spaceId] : [],
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

  return rows.flatMap((r): NotificationView[] => {
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
      const item: Part = { text: now.title, em: "item", quote: true };
      const at = { title: now.list, url: `/?p=${encodeURIComponent(now.projectId)}&item=${encodeURIComponent(now.id)}` };
      const say = (parts: Part[], snippet: string | null = null): NotificationView[] => [
        { ...base, ...at, parts, snippet },
      ];
      switch (event.type) {
        case "item.created":
          return r.reason === "assigned"
            ? say([who, t(" added "), item, t(" for you")])
            : say([who, t(" added "), item, t(" to "), { text: event.parent?.title ?? "", em: "item", quote: true }]);
        case "item.updated":
          if (r.reason === "assigned") return say([who, t(" assigned you "), item]);
          if (r.reason === "unassigned") return say([who, t(" took you off "), item]);
          return event.changes.due?.dueDate
            ? say([who, t(" set "), item, t(` due ${dueText(event.changes.due)}`)])
            : say([who, t(" cleared the due date on "), item]);
        case "item.completed":
          return say([who, t(" completed "), item]);
        case "item.reopened":
          return event.repeat
            ? say([item, t(" is due again")])
            : say([who, t(" reopened "), item]);
        case "item.moved":
          return say([who, t(" moved "), item, t(" to "), { text: now.list, em: "place", quote: true }]);
        case "agent.requested":
          return say([who, t(" asked "), { text: event.agent, em: "person" }, t(" to work on "), item]);
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
          parts: [who, t(" invited you to "), { text: name, em: "place", quote: true }],
          snippet: null,
        },
      ];
    }
    // Joins and roles: only while the reader is still in the list or Space,
    // by its current name.
    if (event.type === "member.joined") {
      const name = lists.get(event.projectId);
      if (!name) return [];
      return [
        {
          ...base,
          title: name,
          url: `/?p=${encodeURIComponent(event.projectId)}`,
          parts: [who, t(" joined "), { text: name, em: "place", quote: true }],
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
              ? [who, t(event.role === "admin" ? " made you an admin of " : " made you a member of "), space]
              : [who, t(" joined "), space],
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
  const order = [desc(notifications.createdAt), desc(notifications.id)];
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
  return [...unseen, ...seen.slice(0, INBOX_SIZE)].sort(
    (a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1),
  );
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

// Older than this when its turn comes (say the server stopped before sending
// it), a push is news nobody needs any more: it stays in the inbox only.
const PUSH_FRESH_MS = 10 * 60_000;

/**
 * Push every notification not sent yet, worded as it's sent. Each is
 * claimed (sentAt set) before any await, so runs that overlap never send
 * one twice; one whose push fails stays claimed and in the inbox. Off
 * without VAPID keys.
 */
export async function deliverNotifications(db: Db): Promise<void> {
  const now = Date.now();
  let due = db
    .select({ id: notifications.id, userId: notifications.userId, groupKey: notifications.groupKey })
    .from(notifications)
    .where(isNull(notifications.sentAt))
    .all();
  if (due.length === 0) return;
  // Only rows still unsent, so another run that read the same ones sends
  // only what it claimed.
  // audit-exempt: delivery bookkeeping on derived rows.
  const claimed = new Set(
    db.update(notifications)
      .set({ sentAt: now })
      .where(and(inArray(notifications.id, due.map((n) => n.id)), isNull(notifications.sentAt)))
      .returning({ id: notifications.id })
      .all()
      .map((r) => r.id),
  );
  const vapid = getEnv().VAPID;
  if (!vapid) return;
  due = due.filter((n) => claimed.has(n.id));
  const tags = new Map(due.map((n) => [n.id, n.groupKey]));
  const sends = [...new Set(due.map((n) => n.userId))].flatMap((userId) => {
    const rows = selectRows(db)
      .where(
        and(
          eq(notifications.userId, userId),
          inArray(notifications.id, due.filter((n) => n.userId === userId).map((n) => n.id)),
        ),
      )
      .all();
    return describe(db, userId, rows)
      .filter((n) => n.createdAt > now - PUSH_FRESH_MS)
      .map(async (n) => {
        const { gone } = await sendPush(
          pushTargets(db, userId, vapid.publicKey),
          {
            title: n.title,
            body: plainText(n.parts) + (n.snippet ? `: ${n.snippet}` : ""),
            url: n.url,
            // A newer push about the same thing replaces this one.
            tag: tags.get(n.id),
          },
          vapid,
        );
        forgetPushSubscriptions(db, gone);
      });
  });
  await Promise.all(sends);
}

declare global {
  var __sidetrackNotificationDelivery: boolean | undefined;
}

/**
 * Push new notifications after each committed batch of changes. recordAudit
 * announces every audited change, and a notification is only ever written
 * with one, so this hears about each. Started once per process, at boot.
 */
export function startNotificationDelivery(db: Db): void {
  if (globalThis.__sidetrackNotificationDelivery) return;
  globalThis.__sidetrackNotificationDelivery = true;
  const deliver = () =>
    deliverNotifications(db).catch((error) => getPostHog()?.captureException(error));
  onChanges(deliver);
  // Whatever was committed but not sent before the last stop.
  void deliver();
}
