import { and, eq, or, sql } from "drizzle-orm";
import type { Db } from "./db";
import { type Project, projectMembers, projects, spaceMembers } from "./schema";

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
 * The read/edit access predicate for a project: the owner (`projects.userId`),
 * anyone with an *accepted* `project_members` row, OR anyone with an accepted
 * `space_members` row in the project's Space. One predicate gates both
 * reads and edits — there is no view-only role. Owner-only actions (delete,
 * prefix change, managing members) keep filtering on `projects.userId`
 * directly. A `pending` invite grants nothing until the target accepts.
 *
 * Db-independent on purpose: it emits a correlated `EXISTS` subquery, so it
 * drops into any `WHERE` that already has `projects` in scope without an extra
 * join or a `db` handle to thread. With no accepted member rows and no Space
 * it is exactly equivalent to `eq(projects.userId, userId)`. A Space role
 * doesn't matter here: admins and members have the same access to its lists.
 */
export function hasProjectAccess(userId: string) {
  return or(
    eq(projects.userId, userId),
    sql`exists (select 1 from ${projectMembers} where ${projectMembers.projectId} = ${projects.id} and ${projectMembers.userId} = ${userId} and ${projectMembers.status} = 'accepted')`,
    sql`exists (select 1 from ${spaceMembers} where ${spaceMembers.spaceId} = ${projects.spaceId} and ${spaceMembers.userId} = ${userId} and ${spaceMembers.status} = 'accepted')`,
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
