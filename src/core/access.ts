import { and, eq, or, type SQL, sql } from "drizzle-orm";
import type { Db } from "./db";
import {
  items,
  type ListAccess,
  type ListRole,
  type Project,
  projectMembers,
  projects,
  type SpaceRole,
  spaceMembers,
} from "./schema";

/** The list and Space roles that reach each kind of access, and every kind above it. */
const LIST_ROLES_FOR: Record<ListAccess, ListRole[]> = {
  view: ["editor", "commenter", "viewer"],
  comment: ["editor", "commenter"],
  edit: ["editor"],
};
const SPACE_ROLES_FOR: Record<ListAccess, SpaceRole[]> = {
  view: ["admin", "member", "commenter", "viewer"],
  comment: ["admin", "member", "commenter"],
  edit: ["admin", "member"],
};
const inList = (roles: string[]) => sql.join(roles.map((r) => sql`${r}`), sql`, `);

/**
 * Whether `userId` is the list's admin: its owner, or an admin of the Space
 * it's in. Admins decide where agents work on a list (its repository) and
 * which agents do, so these stay with them rather than every member.
 */
export function isListAdmin(
  db: Db,
  userId: string,
  project: Pick<Project, "userId" | "spaceId">,
): boolean {
  if (project.userId === userId) return true;
  if (!project.spaceId) return false;
  const row = db
    .select({ role: spaceMembers.role })
    .from(spaceMembers)
    .where(
      and(
        eq(spaceMembers.spaceId, project.spaceId),
        eq(spaceMembers.userId, userId),
        eq(spaceMembers.status, "accepted"),
      ),
    )
    .get();
  return row?.role === "admin";
}

/**
 * The read access predicate for a project: the owner (`projects.userId`),
 * anyone with an *accepted* `project_members` row, OR anyone with an accepted
 * `space_members` row in the project's Space, whatever their role. Changes
 * need more: canEditProject, or canCommentProject for comments. Owner-only
 * actions (delete, prefix change, managing members) keep filtering on
 * `projects.userId` directly. A `pending` invite grants nothing until the
 * target accepts.
 *
 * Db-independent on purpose: it emits a correlated `EXISTS` subquery, so it
 * drops into any `WHERE` that already has `projects` in scope without an extra
 * join or a `db` handle to thread. With no accepted member rows and no Space
 * it is exactly equivalent to `eq(projects.userId, userId)`.
 */
export function hasProjectAccess(userId: string) {
  return projectAccessAtLeast(userId, "view");
}

/** As hasProjectAccess, for those who may change the list's items and settings. */
export function canEditProject(userId: string) {
  return projectAccessAtLeast(userId, "edit");
}

/** As hasProjectAccess, for those who may comment: editors and commenters. */
export function canCommentProject(userId: string) {
  return projectAccessAtLeast(userId, "comment");
}

function projectAccessAtLeast(userId: string, access: ListAccess) {
  return or(
    eq(projects.userId, userId),
    sql`exists (select 1 from ${projectMembers} where ${projectMembers.projectId} = ${projects.id} and ${projectMembers.userId} = ${userId} and ${projectMembers.status} = 'accepted' and ${projectMembers.role} in (${inList(LIST_ROLES_FOR[access])}))`,
    sql`exists (select 1 from ${spaceMembers} where ${spaceMembers.spaceId} = ${projects.spaceId} and ${spaceMembers.userId} = ${userId} and ${spaceMembers.status} = 'accepted' and ${spaceMembers.role} in (${inList(SPACE_ROLES_FOR[access])}))`,
  );
}

/**
 * As hasProjectAccess, for one item: `items` and `projects` must be in
 * scope. A membership limited to someone's items (`only_assigned_to`) opens
 * only the item groups assigned to them: an item with its sub-items, whole,
 * when that person is on any of them. Any other route in opens every item,
 * so the most generous route still counts. Use it wherever an item, or
 * something about one (its comments, history, counts), is read.
 */
export function hasItemAccess(userId: string) {
  // The item's group: its parent's, for a sub-item.
  const group = sql`coalesce(${items.parentId}, ${items.id})`;
  const sees = (limitedTo: SQL) =>
    sql`(${limitedTo} is null or exists (select 1 from items g, json_each(g.assignee_ids) a where (g.id = ${group} or g.parent_id = ${group}) and a.value = ${limitedTo}))`;
  return or(
    eq(projects.userId, userId),
    sql`exists (select 1 from ${projectMembers} pm where pm.project_id = ${projects.id} and pm.user_id = ${userId} and pm.status = 'accepted' and ${sees(sql`pm.only_assigned_to`)})`,
    sql`exists (select 1 from ${spaceMembers} sm where sm.space_id = ${projects.spaceId} and sm.user_id = ${userId} and sm.status = 'accepted' and ${sees(sql`sm.only_assigned_to`)})`,
  );
}

/**
 * Whether `userId` can see the item now. Once it's deleted there's nothing
 * left to check its assignees on, so only those who see its whole list can.
 */
export function canSeeItem(db: Db, userId: string, itemId: string, projectId: string): boolean {
  const here = db
    .select({ id: items.id })
    .from(items)
    .innerJoin(projects, eq(projects.id, items.projectId))
    .where(and(eq(items.id, itemId), hasItemAccess(userId)))
    .get();
  if (here) return true;
  const exists = db.select({ id: items.id }).from(items).where(eq(items.id, itemId)).get();
  if (exists) return false;
  return !!db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), hasWholeListAccess(userId)))
    .get();
}

/** As hasProjectAccess, for those who see every item on it: no route in limited to someone's items. */
export function hasWholeListAccess(userId: string) {
  return or(
    eq(projects.userId, userId),
    sql`exists (select 1 from ${projectMembers} pm where pm.project_id = ${projects.id} and pm.user_id = ${userId} and pm.status = 'accepted' and pm.only_assigned_to is null)`,
    sql`exists (select 1 from ${spaceMembers} sm where sm.space_id = ${projects.spaceId} and sm.user_id = ${userId} and sm.status = 'accepted' and sm.only_assigned_to is null)`,
  );
}

/** What `userId` can do on each list they can open, by list id. */
export function listAccessById(db: Db, userId: string): Map<string, ListAccess> {
  const access = sql<ListAccess>`case when ${canEditProject(userId)} then 'edit' when ${canCommentProject(userId)} then 'comment' else 'view' end`;
  return new Map(
    db
      .select({ id: projects.id, access })
      .from(projects)
      .where(hasProjectAccess(userId))
      .all()
      .map((r) => [r.id, r.access]),
  );
}

/** What `userId` can do on the list: the most its routes in give; null when it can't open it. */
export function listAccess(db: Db, userId: string, projectId: string): ListAccess | null {
  for (const access of ["edit", "comment", "view"] as const) {
    const found = db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), projectAccessAtLeast(userId, access)))
      .get();
    if (found) return access;
  }
  return null;
}

/**
 * Throws unless `userId` may `need` on the list ("edit" or "comment"). Call
 * it once the item or list is found, so someone who can't open it still gets
 * "not found" rather than learning it exists.
 */
export function requireListAccess(
  db: Db,
  userId: string,
  projectId: string,
  need: Exclude<ListAccess, "view">,
): void {
  const has = listAccess(db, userId, projectId);
  if (has === "edit" || has === need) return;
  throw new Error(
    has === "comment"
      ? "you can comment on this list but not change it"
      : "you can view this list but not change it",
  );
}

/** Everyone who can open the list: its owner, its members and its Space's. */
export function listMemberIds(db: Db, projectId: string): string[] {
  const list = db
    .select({ userId: projects.userId, spaceId: projects.spaceId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  if (!list) return [];
  const members = db
    .select({ userId: projectMembers.userId })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.status, "accepted")))
    .all();
  const inSpace = list.spaceId
    ? db
        .select({ userId: spaceMembers.userId })
        .from(spaceMembers)
        .where(and(eq(spaceMembers.spaceId, list.spaceId), eq(spaceMembers.status, "accepted")))
        .all()
    : [];
  return [...new Set([list.userId, ...members.map((m) => m.userId), ...inSpace.map((m) => m.userId)])];
}
