import { and, asc, eq, type SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import { hasProjectAccess } from "./access";
import { users } from "./auth-schema";
import { type AuditOrigin, recordAudit } from "./audit";
import type { Db } from "./db";
import { getItem } from "./items";
import { type Comment, comments, type Item, items, projects } from "./schema";

// Comments are accessed through their item → project, like PR links: whoever
// can open an item can read and add its comments, and only a comment's author
// can edit or delete it.

/** Longest comment, in characters. */
export const COMMENT_MAX = 10_000;

/** A comment with its author's display fields; author is null for a deleted user. */
export interface CommentView extends Comment {
  author: {
    userId: string;
    name: string | null;
    displayUsername: string | null;
    email: string | null;
    image: string | null;
  } | null;
}

function cleanBody(raw: string): string {
  const body = raw.trim();
  if (!body) throw new Error("comment is empty");
  // Count characters (code points), not UTF-16 units, so an emoji counts once.
  const length = [...body].length;
  if (length > COMMENT_MAX) {
    throw new Error(`comment is too long (${length} characters, max ${COMMENT_MAX})`);
  }
  return body;
}

function selectComments(db: Db, userId: string, where: SQL) {
  return db
    .select({
      comment: comments,
      name: users.name,
      displayUsername: users.displayUsername,
      email: users.email,
      image: users.image,
    })
    .from(comments)
    .innerJoin(items, eq(items.id, comments.itemId))
    .innerJoin(projects, eq(projects.id, items.projectId))
    // Left join, so a deleted user's comments still show.
    .leftJoin(users, eq(users.id, comments.userId))
    .where(and(where, hasProjectAccess(userId)))
    .orderBy(asc(comments.createdAt), asc(comments.id))
    .all()
    .map(({ comment, name, displayUsername, email, image }) => ({
      ...comment,
      author:
        name === null && email === null
          ? null
          : { userId: comment.userId, name, displayUsername, email, image },
    }));
}

/** The item's comments, oldest first; none when the user can't open it. */
export function listComments(db: Db, userId: string, itemId: string): CommentView[] {
  return selectComments(db, userId, eq(comments.itemId, itemId));
}

function getComment(db: Db, userId: string, id: string): CommentView | undefined {
  return selectComments(db, userId, eq(comments.id, id))[0];
}

/** The comment and its item, for a change only its author may make. */
function ownComment(db: Db, userId: string, id: string): { comment: Comment; item: Item } {
  const comment = getComment(db, userId, id);
  if (!comment) throw new Error(`comment not found: ${id}`);
  if (comment.userId !== userId) {
    throw new Error("only a comment's author can change it");
  }
  const item = getItem(db, userId, comment.itemId);
  if (!item) throw new Error(`item not found: ${comment.itemId}`);
  return { comment, item };
}

export function addComment(
  db: Db,
  userId: string,
  itemId: string,
  rawBody: string,
  source: AuditOrigin,
): CommentView {
  const item = getItem(db, userId, itemId);
  if (!item) throw new Error(`item not found: ${itemId}`);
  const body = cleanBody(rawBody);
  const agent = typeof source === "object" ? source.agent : null;
  const id = nanoid(12);
  db.transaction((tx) => {
    tx.insert(comments)
      .values({
        id,
        itemId,
        userId,
        agentKeyId: agent?.keyId ?? null,
        agentName: agent?.name ?? null,
        body,
        createdAt: Date.now(),
      })
      .run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      action: "create",
      entityType: "comment",
      entityId: id,
      projectId: item.projectId,
      parentId: item.id,
      detail: `commented on "${item.title}"`,
    });
  });
  const created = getComment(db, userId, id);
  if (!created) throw new Error(`comment not found after insert: ${id}`);
  return created;
}

/** Author only. No-op (no audit) when the text is unchanged. */
export function updateComment(
  db: Db,
  userId: string,
  id: string,
  rawBody: string,
  source: AuditOrigin,
): CommentView {
  const { comment, item } = ownComment(db, userId, id);
  const body = cleanBody(rawBody);
  if (body !== comment.body) {
    db.transaction((tx) => {
      tx.update(comments)
        .set({ body, editedAt: Date.now() })
        .where(eq(comments.id, id))
        .run();
      recordAudit(tx as unknown as Db, {
        actor: userId,
        source,
        action: "update",
        entityType: "comment",
        entityId: id,
        projectId: item.projectId,
        parentId: item.id,
        detail: `edited a comment on "${item.title}"`,
      });
    });
  }
  const updated = getComment(db, userId, id);
  if (!updated) throw new Error(`comment not found after update: ${id}`);
  return updated;
}

/** Author only. */
export function deleteComment(
  db: Db,
  userId: string,
  id: string,
  source: AuditOrigin,
): void {
  const { item } = ownComment(db, userId, id);
  db.transaction((tx) => {
    tx.delete(comments).where(eq(comments.id, id)).run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      action: "delete",
      entityType: "comment",
      entityId: id,
      projectId: item.projectId,
      parentId: item.id,
      detail: `deleted a comment on "${item.title}"`,
    });
  });
}
