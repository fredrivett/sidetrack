import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getEnv } from "../lib/env";
import { getPostHog } from "../lib/posthog";
import { sendPush } from "../lib/push";
import { hasProjectAccess } from "./access";
import { users } from "./auth-schema";
import { onChanges } from "./changes";
import type { Db } from "./db";
import { type Part, plainText } from "./describe";
import type { ChangeEvent, ItemAt } from "./events";
import { forgetPushSubscriptions, pushTargets } from "./push";
import {
  auditLog,
  comments,
  items,
  type NotificationReason,
  notifications,
  projects,
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

/** Who `event` concerns and why, before the checks every rule shares. */
function rule(
  db: Db,
  event: ChangeEvent,
  actor: string,
): { to: string[]; reason: NotificationReason; groupKey: string; projectId?: string } | null {
  switch (event.type) {
    case "item.created": {
      // Logged as already done, it asks nothing of anyone.
      const done = db
        .select({ completedAt: items.completedAt })
        .from(items)
        .where(eq(items.id, event.itemId))
        .get()?.completedAt;
      if (done) return null;
      return {
        to: event.assignees.map((a) => a.userId),
        reason: "assigned",
        groupKey: `item:${event.itemId}`,
        projectId: event.projectId,
      };
    }
    case "item.updated":
      return event.changes.assignees
        ? {
            to: event.changes.assignees.added.map((a) => a.userId),
            reason: "assigned",
            groupKey: `item:${event.itemId}`,
            projectId: event.projectId,
          }
        : null;
    case "comment.created":
    case "comment.edited":
      return event.mentioned
        ? {
            to: event.mentioned.map((p) => p.userId),
            reason: "mentioned",
            groupKey: `item:${event.item.itemId}`,
            projectId: event.projectId,
          }
        : null;
    case "member.invited":
      return { to: [event.member.userId], reason: "invited", groupKey: `list:${event.projectId}` };
    case "space.member.invited":
      return {
        to: [event.member.userId],
        reason: "invited",
        groupKey: `space:${event.space.spaceId}`,
      };
    case "agent.finished":
      // The agent's owner: it was working for them.
      return {
        to: [actor],
        reason: "agent-finished",
        groupKey: `item:${event.itemId}`,
        projectId: event.projectId,
      };
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
  let to = [...new Set(r.to)].filter((u) => change.agent || u !== change.actor);
  if (r.projectId) {
    const projectId = r.projectId;
    to = to.filter((u) =>
      db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, projectId), hasProjectAccess(u)))
        .get(),
    );
  }
  if (to.length === 0) return;
  db.insert(notifications)
    .values(
      to.map((userId) => ({
        id: nanoid(12),
        userId,
        reason: r.reason,
        auditId: change.auditId,
        groupKey: r.groupKey,
        createdAt: change.ts,
      })),
    )
    .run();
}

type Row = {
  id: string;
  reason: NotificationReason;
  createdAt: number;
  readAt: number | null;
  event: ChangeEvent | null;
  agentName: string | null;
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

  return rows.flatMap((r): NotificationView[] => {
    const event = r.event;
    if (!event) return [];
    const a = r.actor;
    const who: Part = {
      text:
        r.agentName ??
        (a?.name || (a?.displayUsername ? `@${a.displayUsername}` : a?.email) || "Someone"),
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
      switch (event.type) {
        case "item.created":
          return [{ ...base, ...at, parts: [who, t(" added "), item, t(" for you")], snippet: null }];
        case "item.updated":
          return [{ ...base, ...at, parts: [who, t(" assigned you "), item], snippet: null }];
        case "comment.created":
        case "comment.edited": {
          const body = bodies.get(event.commentId);
          return [
            {
              ...base,
              ...at,
              parts: [who, t(" mentioned you on "), item],
              snippet: body ? excerpt(body) : null,
            },
          ];
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
    return [];
  });
}

/** The user's latest notifications, newest first. */
export function listNotifications(db: Db, userId: string): NotificationView[] {
  const rows = selectRows(db)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(INBOX_SIZE)
    .all();
  return describe(db, userId, rows);
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
  const due = db
    .select({ id: notifications.id, userId: notifications.userId, groupKey: notifications.groupKey })
    .from(notifications)
    .where(isNull(notifications.sentAt))
    .all();
  if (due.length === 0) return;
  // audit-exempt: delivery bookkeeping on derived rows.
  db.update(notifications)
    .set({ sentAt: now })
    .where(inArray(notifications.id, due.map((n) => n.id)))
    .run();
  const vapid = getEnv().VAPID;
  if (!vapid) return;
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
  onChanges(() => {
    deliverNotifications(db).catch((error) => getPostHog()?.captureException(error));
  });
}
