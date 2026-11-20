import { and, asc, desc, eq, type SQL, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { hasProjectAccess, requireListAccess } from "./access";
import { users } from "./auth-schema";
import { type AuditOrigin, recordAudit } from "./audit";
import type { Db } from "./db";
import { formatItemRef } from "../lib/itemRef";
import { mentionedPeople } from "../lib/mentions";
import { getItem } from "./items";
import type { PersonAt } from "./events";
import { listAssignees, personAt } from "./members";
import { getProject } from "./projects";
import { type Comment, COMMENT_MAX, comments, type Item, items, projects } from "./schema";

// Comments are accessed through their item → project, like PR links: whoever
// can open an item can read and add its comments, and only a comment's author
// can edit or delete it.

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

/** A comment in a feed across items: the comment plus the item it's on. */
export interface FeedComment extends CommentView {
  item: Pick<Item, "id" | "title" | "number" | "projectId" | "completedAt">;
}

function selectComments(
  db: Db,
  userId: string,
  where: SQL | undefined,
  opts: { newestFirst?: boolean; limit?: number } = {},
): FeedComment[] {
  // Ties (two comments in the same millisecond) keep the order they were
  // added in.
  const dir = opts.newestFirst ? desc : asc;
  const query = db
    .select({
      comment: comments,
      item: {
        id: items.id,
        title: items.title,
        number: items.number,
        projectId: items.projectId,
        completedAt: items.completedAt,
      },
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
    .orderBy(dir(comments.createdAt), dir(sql`${comments}.rowid`));
  return (opts.limit ? query.limit(opts.limit) : query)
    .all()
    .map(({ comment, item, name, displayUsername, email, image }) => ({
      ...comment,
      item,
      author:
        name === null && email === null
          ? null
          : { userId: comment.userId, name, displayUsername, email, image },
    }));
}

/**
 * The newest comments on items the user can open, in one list or across all
 * of them, newest first: the Activity view's Comments tab.
 */
export function listRecentComments(
  db: Db,
  userId: string,
  opts: { projectId?: string; limit?: number } = {},
): FeedComment[] {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  return selectComments(
    db,
    userId,
    opts.projectId ? eq(items.projectId, opts.projectId) : undefined,
    { newestFirst: true, limit },
  );
}

/** The item's comments, oldest first; none when the user can't open it. */
export function listComments(db: Db, userId: string, itemId: string): CommentView[] {
  return selectComments(db, userId, eq(comments.itemId, itemId)).map(withoutItem);
}

/** How many comments each item the user can open has, for the board's rows; items without any are left out. */
export function countCommentsByItem(db: Db, userId: string): Record<string, number> {
  const rows = db
    .select({ itemId: comments.itemId, count: sql<number>`count(*)` })
    .from(comments)
    .innerJoin(items, eq(items.id, comments.itemId))
    .innerJoin(projects, eq(projects.id, items.projectId))
    .where(hasProjectAccess(userId))
    .groupBy(comments.itemId)
    .all();
  return Object.fromEntries(rows.map((r) => [r.itemId, r.count]));
}

export function getComment(db: Db, userId: string, id: string): CommentView | undefined {
  return selectComments(db, userId, eq(comments.id, id)).map(withoutItem)[0];
}

// Where it's already known which item the comments are on.
function withoutItem(comment: FeedComment): CommentView {
  const view: CommentView & { item?: unknown } = { ...comment };
  delete view.item;
  return view;
}

/** Who a comment's mentions reach, and what to tell them. */
export interface MentionNotice {
  to: { userId: string; email: string; name: string | null }[];
  /** Who wrote it, and the agent that wrote it for them. */
  authorName: string;
  itemRef: string;
  itemTitle: string;
  body: string;
}

/** The people `body` @mentions on the list who `before`, the text it
 * replaced, didn't, as an event names them. Undefined when there are none. */
function newlyMentioned(
  db: Db,
  userId: string,
  projectId: string,
  body: string,
  before?: string,
): PersonAt[] | undefined {
  const people = listAssignees(db, userId, projectId);
  const already = new Set(before === undefined ? [] : mentionedPeople(before, people));
  const added = mentionedPeople(body, people).filter((p) => !already.has(p));
  return added.length
    ? added.map((p) => personAt({ id: p.userId, username: p.username }))
    : undefined;
}

/**
 * The people a comment @mentions who can open its item, to notify. `before`,
 * the text an edit replaced, leaves out who it already mentioned. The author
 * mentioning themselves isn't news, unless an agent wrote it for them: then
 * it's how the agent gets their attention. Null when there's no one to tell.
 */
export function mentionNotice(
  db: Db,
  userId: string,
  comment: CommentView,
  before?: string,
): MentionNotice | null {
  const item = getItem(db, userId, comment.itemId);
  const project = item && getProject(db, userId, item.projectId);
  if (!item || !project) return null;
  const people = listAssignees(db, userId, item.projectId);
  const already = new Set(before === undefined ? [] : mentionedPeople(before, people));
  const to = mentionedPeople(comment.body, people).flatMap((p) =>
    !already.has(p) && p.email && (comment.agentName || p.userId !== comment.userId)
      ? [{ userId: p.userId, email: p.email, name: p.name }]
      : [],
  );
  if (to.length === 0) return null;
  const a = comment.author;
  const author =
    a?.name ?? (a?.displayUsername ? `@${a.displayUsername}` : a?.email) ?? "Someone";
  return {
    to,
    authorName: comment.agentName ? `${comment.agentName} (for ${author})` : author,
    itemRef: formatItemRef(project.prefix, item.number),
    itemTitle: item.title,
    body: comment.body,
  };
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
  requireListAccess(db, userId, item.projectId, "comment");
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
      event: {
        type: "comment.created",
        projectId: item.projectId,
        commentId: id,
        item: { itemId: item.id, title: item.title },
        mentioned: newlyMentioned(tx as unknown as Db, userId, item.projectId, body),
      },
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
  // Deleting their own words stays open to them whatever their role; editing them doesn't.
  requireListAccess(db, userId, item.projectId, "comment");
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
        event: {
          type: "comment.edited",
          projectId: item.projectId,
          commentId: id,
          item: { itemId: item.id, title: item.title },
          mentioned: newlyMentioned(tx as unknown as Db, userId, item.projectId, body, comment.body),
        },
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
      event: {
        type: "comment.deleted",
        projectId: item.projectId,
        commentId: id,
        item: { itemId: item.id, title: item.title },
      },
    });
  });
}
