import { and, eq, inArray, or } from "drizzle-orm";
import { hasProjectAccess } from "./access";
import type { Db } from "./db";
import { getItem } from "./items";
import { itemFollows, items, projects } from "./schema";

// Following: who hears an item's activity (the Involved tier in
// notifications.ts). People follow automatically when they create an item,
// are assigned to it, comment on it or are mentioned in a comment on it;
// anyone who can open it can also follow or unfollow it themselves. An
// unfollow sticks: those automatic follows never undo it. Following a
// parent covers its sub-items. Per person and seen by nobody else, so not
// audited, like a list's position.

/**
 * Follow `itemId` for each of `userIds` who hasn't chosen either way yet.
 * Runs inside the change that makes them involved (notifications.ts).
 */
// audit-exempt: per-person delivery state, inside the change's audited transaction.
export function autoFollow(db: Db, itemId: string, userIds: string[]): void {
  if (userIds.length === 0) return;
  db.insert(itemFollows)
    .values([...new Set(userIds)].map((userId) => ({ itemId, userId, following: true, createdAt: Date.now() })))
    .onConflictDoNothing()
    .run();
}

/** Follow or unfollow an item the user can open. */
// audit-exempt: per-person delivery state, seen by nobody else.
export function setFollowing(db: Db, userId: string, itemId: string, following: boolean): void {
  if (!getItem(db, userId, itemId)) throw new Error(`item not found: ${itemId}`);
  db.insert(itemFollows)
    .values({ itemId, userId, following, createdAt: Date.now() })
    .onConflictDoUpdate({
      target: [itemFollows.itemId, itemFollows.userId],
      set: { following },
    })
    .run();
}

/**
 * Who follows `itemId`: those following it, and those following its parent
 * who haven't unfollowed it.
 */
export function followersOf(db: Db, itemId: string): string[] {
  const parentId =
    db.select({ parentId: items.parentId }).from(items).where(eq(items.id, itemId)).get()
      ?.parentId ?? null;
  const rows = db
    .select({ itemId: itemFollows.itemId, userId: itemFollows.userId, following: itemFollows.following })
    .from(itemFollows)
    .where(
      parentId
        ? or(eq(itemFollows.itemId, itemId), eq(itemFollows.itemId, parentId))
        : eq(itemFollows.itemId, itemId),
    )
    .all();
  const own = new Map(rows.filter((r) => r.itemId === itemId).map((r) => [r.userId, r.following]));
  const viaParent = rows.filter((r) => r.itemId !== itemId && r.following && !own.has(r.userId));
  return [
    ...[...own].flatMap(([userId, following]) => (following ? [userId] : [])),
    ...viaParent.map((r) => r.userId),
  ];
}

/**
 * The items `userId` follows, among those they can open: their own follows,
 * and sub-items of those they haven't unfollowed.
 */
export function listFollowedItemIds(db: Db, userId: string): string[] {
  const own = db
    .select({ itemId: itemFollows.itemId, following: itemFollows.following })
    .from(itemFollows)
    .innerJoin(items, eq(items.id, itemFollows.itemId))
    .innerJoin(projects, eq(projects.id, items.projectId))
    .where(and(eq(itemFollows.userId, userId), hasProjectAccess(userId)))
    .all();
  const choice = new Map(own.map((r) => [r.itemId, r.following]));
  const followed = own.filter((r) => r.following).map((r) => r.itemId);
  const subItems = followed.length
    ? db.select({ id: items.id }).from(items).where(inArray(items.parentId, followed)).all()
    : [];
  return [
    ...new Set([...followed, ...subItems.flatMap((c) => (choice.get(c.id) === false ? [] : [c.id]))]),
  ];
}
