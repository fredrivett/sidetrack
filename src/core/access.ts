import { and, eq, inArray, or, type SQL, sql } from "drizzle-orm";
import { users } from "./auth-schema";
import type { Db } from "./db";
import { validZone } from "./db-functions";
import { dayOf, nextDayStartIn, startOfWeekIn } from "../lib/time";
import {
  items,
  type ListAccess,
  type ListRole,
  type OnlyWithin,
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
  const sees = (limitedTo: SQL, within: SQL) =>
    sql`(${limitedTo} is null or (exists (select 1 from items g, json_each(g.assignee_ids) a where (g.id = ${group} or g.parent_id = ${group}) and a.value = ${limitedTo}) and ${inWindow(group, limitedTo, within)}))`;
  return or(
    eq(projects.userId, userId),
    sql`exists (select 1 from ${projectMembers} pm where pm.project_id = ${projects.id} and pm.user_id = ${userId} and pm.status = 'accepted' and ${sees(sql`pm.only_assigned_to`, sql`pm.only_within`)})`,
    sql`exists (select 1 from ${spaceMembers} sm where sm.space_id = ${projects.spaceId} and sm.user_id = ${userId} and sm.status = 'accepted' and ${sees(sql`sm.only_assigned_to`, sql`sm.only_within`)})`,
  );
}

/**
 * Whether an item group falls in a membership's window (`only_within`) of
 * `person`'s days, by their clock (st_today, from db-functions.ts): some item
 * in it, with a due date, that's still open and due by the window's end
 * (overdue counts, or it'd hide by slipping; a span counts from its first
 * day), or that was finished within it. No window is every day.
 */
function inWindow(group: SQL, person: SQL, within: SQL) {
  const tz = sql`(select ${users.timeZone} from ${users} where ${users.id} = ${person})`;
  const today = sql`st_today(${tz})`;
  const monday = sql`st_week_start(${tz})`;
  const lands = (from: SQL, to: SQL) =>
    sql`((w.completed_at is null and coalesce(w.due_from, w.due_date) <= ${to}) or (w.completed_at is not null and st_day(w.completed_at, ${tz}) between ${from} and ${to}))`;
  return sql`(${within} is null or exists (select 1 from items w where (w.id = ${group} or w.parent_id = ${group}) and w.due_date is not null and (case ${within} when 'today' then ${lands(today, today)} else ${lands(monday, sql`date(${monday}, '+6 days')`)} end)))`;
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

/**
 * The lists `userId` sees only part of, by list id, each with whose items
 * they see (a name for the badge: \`@lorna\`), how much of their days, and
 * with that, when their day next turns over and what's shown changes.
 * Lists they see whole are left out.
 */
export function limitedListsById(
  db: Db,
  userId: string,
): Map<
  string,
  {
    personId: string;
    username: string | null;
    name: string;
    image: string | null;
    within: OnlyWithin | null;
    /** Their day (YYYY-MM-DD) the window counts from, with turnsAt when it moves on. */
    day: string | null;
    turnsAt: number | null;
  }
> {
  const rows = db
    .select({
      id: projects.id,
      // Spelled out: in a select field drizzle leaves columns unqualified,
      // and a bare "id" here would be the member row's.
      limitedTo: sql<string>`coalesce(
        (select pm.only_assigned_to from ${projectMembers} pm where pm.project_id = "projects"."id" and pm.user_id = ${userId} and pm.status = 'accepted'),
        (select sm.only_assigned_to from ${spaceMembers} sm where sm.space_id = "projects"."space_id" and sm.user_id = ${userId} and sm.status = 'accepted')
      )`,
      // From the same membership as limitedTo.
      within: sql<OnlyWithin | null>`coalesce(
        (select case when pm.only_assigned_to is null then null else coalesce(pm.only_within, '') end from ${projectMembers} pm where pm.project_id = "projects"."id" and pm.user_id = ${userId} and pm.status = 'accepted'),
        (select sm.only_within from ${spaceMembers} sm where sm.space_id = "projects"."space_id" and sm.user_id = ${userId} and sm.status = 'accepted')
      )`,
    })
    .from(projects)
    .where(and(hasProjectAccess(userId), sql`not (${hasWholeListAccess(userId)})`))
    .all();
  const names = new Map(
    rows.length
      ? db
          .select({ id: users.id, username: users.username, name: users.name, image: users.image, timeZone: users.timeZone })
          .from(users)
          .where(inArray(users.id, [...new Set(rows.map((r) => r.limitedTo))]))
          .all()
          .map((u) => [u.id, u])
      : [],
  );
  return new Map(
    rows.map((r) => {
      const person = names.get(r.limitedTo);
      const within = r.within || null;
      return [
        r.id,
        {
          personId: r.limitedTo,
          username: person?.username ?? null,
          name: person?.name || (person?.username ? `@${person.username}` : "someone"),
          image: person?.image ?? null,
          within,
          // st_today's zone: theirs, else UTC.
          // Today, or the Monday a week share starts from.
          day: within ? dayOf(within === "week" ? startOfWeekIn(validZone(person?.timeZone)) : Date.now(), validZone(person?.timeZone)) : null,
          turnsAt: within ? nextDayStartIn(validZone(person?.timeZone)) : null,
        },
      ];
    }),
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
