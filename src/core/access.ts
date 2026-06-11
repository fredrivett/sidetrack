import { eq, or, sql } from "drizzle-orm";
import { projectMembers, projects } from "./schema";

/**
 * The read/edit access predicate for a project: the owner (`projects.userId`)
 * OR anyone with an *accepted* `project_members` row. One predicate gates both
 * reads and edits — there is no view-only role. Owner-only actions (delete,
 * prefix change, managing members) keep filtering on `projects.userId`
 * directly. A `pending` invite grants nothing until the target accepts.
 *
 * Db-independent on purpose: it emits a correlated `EXISTS` subquery, so it
 * drops into any `WHERE` that already has `projects` in scope without an extra
 * join or a `db` handle to thread. With no accepted member rows it is exactly
 * equivalent to `eq(projects.userId, userId)`.
 */
export function hasProjectAccess(userId: string) {
  return or(
    eq(projects.userId, userId),
    sql`exists (select 1 from ${projectMembers} where ${projectMembers.projectId} = ${projects.id} and ${projectMembers.userId} = ${userId} and ${projectMembers.status} = 'accepted')`,
  );
}
