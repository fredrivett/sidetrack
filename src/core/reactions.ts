// Emoji reactions: one person's emoji on something someone else did, wrote
// or shared. On a change in an item's history, by its audit row ("Lorna
// completed Water the plants", which is also what her notification is
// about); on a comment; or on a shared day's note or wrap-up, by
// `<userId>:<day>`. Reacting again with the same emoji takes it back. Whose
// thing it is hears about it (notifications.ts, reason "reacted").
//
// Only someone who can see the thing reacts to it, and on a list only
// someone who can comment there, as a reaction is a small comment.

import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { isEmoji } from "../lib/projectIcon";
import { dayOf } from "../lib/time";
import { canSeeItem, hasItemAccess, requireListAccess } from "./access";
import { users } from "./auth-schema";
import { type AuditOrigin, recordAudit, SYSTEM_ACTOR } from "./audit";
import type { Db } from "./db";
import { validZone } from "./db-functions";
import { sharedDayNote } from "./dayNotes";
import type { ChangeEvent, ItemAt, PersonAt } from "./events";
import { personAt } from "./members";
import { auditLog, comments, items, projects, type ReactionTarget, reactions } from "./schema";

export interface ReactionRef {
  type: ReactionTarget;
  id: string;
}

/** One emoji's reactions on a target, as a reader sees them. */
export interface ReactionView {
  emoji: string;
  /** Who reacted with it, in the order they did. */
  people: { userId: string; name: string }[];
  /** Whether the reader is one of them. */
  mine: boolean;
}

/** Key for a target in the maps listReactions returns. */
export const reactionKey = (t: ReactionRef) => `${t.type}:${t.id}`;

/** Whose a target is, where, and what it's about; null when `userId` can't react to it. */
function resolveTarget(
  db: Db,
  userId: string,
  target: ReactionRef,
): { owner: string; projectId: string | null; item?: ItemAt; change?: ChangeEvent["type"] } | null {
  switch (target.type) {
    case "activity": {
      const row = db
        .select({ actor: auditLog.actor, entityType: auditLog.entityType, event: auditLog.event })
        .from(auditLog)
        .where(eq(auditLog.id, target.id))
        .get();
      // A person's change to an item: not Sidetrack's own, and not a
      // comment (react to the comment) or another reaction.
      const e = row?.event;
      if (!row || !e || row.actor === SYSTEM_ACTOR || row.entityType !== "item") return null;
      if (!("itemId" in e) || !("projectId" in e) || !e.projectId) return null;
      if (!canSeeItem(db, userId, e.itemId, e.projectId)) return null;
      const now = db.select({ projectId: items.projectId }).from(items).where(eq(items.id, e.itemId)).get();
      return {
        owner: row.actor,
        projectId: now?.projectId ?? e.projectId,
        item: { itemId: e.itemId, title: e.title },
        change: e.type,
      };
    }
    case "comment": {
      const c = db
        .select({ userId: comments.userId, itemId: items.id, title: items.title, projectId: items.projectId })
        .from(comments)
        .innerJoin(items, eq(items.id, comments.itemId))
        .innerJoin(projects, eq(projects.id, items.projectId))
        .where(and(eq(comments.id, target.id), hasItemAccess(userId)))
        .get();
      if (!c) return null;
      return { owner: c.userId, projectId: c.projectId, item: { itemId: c.itemId, title: c.title } };
    }
    case "day_note":
    case "wrap_up": {
      const [personId, day] = target.id.split(":");
      if (!personId || !day) return null;
      // Their today, while it's shared with the reader.
      const zone = db.select({ tz: users.timeZone }).from(users).where(eq(users.id, personId)).get();
      if (!zone || day !== dayOf(Date.now(), validZone(zone.tz))) return null;
      if (personId === userId) return { owner: personId, projectId: null };
      const seen = sharedDayNote(db, userId, personId);
      const shown =
        target.type === "wrap_up" ? seen.wrapUp !== null : seen.note !== null || seen.mood.length > 0;
      return shown ? { owner: personId, projectId: null } : null;
    }
  }
}

/**
 * React to `target` with `emoji`, or take it back if the user already has.
 * Throws when they can't see it, or can only view its list. Returns whether
 * the reaction is now there.
 */
export function toggleReaction(
  db: Db,
  userId: string,
  target: ReactionRef,
  rawEmoji: string,
  source: AuditOrigin,
): { reacted: boolean } {
  const emoji = rawEmoji.trim();
  if (!isEmoji(emoji)) throw new Error("a reaction is one emoji");
  const found = resolveTarget(db, userId, target);
  if (!found) throw new Error(`not found: ${target.type} ${target.id}`);
  if (found.projectId) requireListAccess(db, userId, found.projectId, "comment");
  const ownerRow = db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(eq(users.id, found.owner))
    .get();
  const owner: PersonAt = ownerRow ? personAt(ownerRow) : { userId: found.owner, name: "someone" };
  const mine = and(
    eq(reactions.targetType, target.type),
    eq(reactions.targetId, target.id),
    eq(reactions.userId, userId),
    eq(reactions.emoji, emoji),
  );
  return db.transaction((tx) => {
    const had = tx.select({ id: reactions.id }).from(reactions).where(mine).get();
    const reactionId = had?.id ?? nanoid(12);
    if (had) tx.delete(reactions).where(eq(reactions.id, had.id)).run();
    else {
      tx.insert(reactions)
        .values({
          id: reactionId,
          targetType: target.type,
          targetId: target.id,
          owner: found.owner,
          userId,
          emoji,
          createdAt: Date.now(),
        })
        .run();
    }
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      event: {
        type: had ? "reaction.removed" : "reaction.added",
        reactionId,
        emoji,
        target: { type: target.type, id: target.id },
        owner,
        projectId: found.projectId,
        ...(found.item && { item: found.item }),
        ...(found.change && { change: found.change }),
      },
    });
    return { reacted: !had };
  });
}

/**
 * The reactions on `targets`, by reactionKey, each emoji in the order it was
 * first used. The caller has already checked `userId` sees the targets.
 */
export function listReactions(
  db: Db,
  userId: string,
  targets: ReactionRef[],
): Record<string, ReactionView[]> {
  if (targets.length === 0) return {};
  const byType = new Map<ReactionTarget, string[]>();
  for (const t of targets) byType.set(t.type, [...(byType.get(t.type) ?? []), t.id]);
  const rows = [...byType].flatMap(([type, ids]) =>
    db
      .select({
        targetType: reactions.targetType,
        targetId: reactions.targetId,
        userId: reactions.userId,
        emoji: reactions.emoji,
        createdAt: reactions.createdAt,
        name: users.name,
        username: users.username,
      })
      .from(reactions)
      .leftJoin(users, eq(users.id, reactions.userId))
      .where(and(eq(reactions.targetType, type), inArray(reactions.targetId, [...new Set(ids)])))
      .all(),
  );
  rows.sort((a, b) => a.createdAt - b.createdAt);
  const out: Record<string, ReactionView[]> = {};
  for (const r of rows) {
    const key = reactionKey({ type: r.targetType, id: r.targetId });
    const list = (out[key] ??= []);
    let view = list.find((v) => v.emoji === r.emoji);
    if (!view) list.push((view = { emoji: r.emoji, people: [], mine: false }));
    view.people.push({ userId: r.userId, name: r.name || (r.username ? `@${r.username}` : "Someone") });
    if (r.userId === userId) view.mine = true;
  }
  return out;
}

/** Whether these reactions still stand, by id: one taken back tells nobody. */
export function standingReactions(db: Db, ids: string[]): Set<string> {
  if (ids.length === 0) return new Set();
  return new Set(
    db
      .select({ id: reactions.id })
      .from(reactions)
      .where(inArray(reactions.id, ids))
      .all()
      .map((r) => r.id),
  );
}
