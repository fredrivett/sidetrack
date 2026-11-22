import { and, asc, count, eq, gte, inArray, isNull, max, sql } from "drizzle-orm";
import { apiKeys, sessions, users } from "./auth-schema";
import type { Db } from "./db";
import { auditLog, items, projectMembers, projects } from "./schema";

// How much each person uses Sidetrack, for the admin view: the changes they
// made (audit rows, from the web or through an agent) on each day.

export interface UserUsage {
  id: string;
  name: string;
  username: string;
  email: string;
  image: string | null;
  createdAt: number;
  /** The day they joined, YYYY-MM-DD in the viewer's time zone, like `DailyUsage.days`. */
  joinedOn: string;
  /** Changes made on each of `DailyUsage.days`, in the same order. */
  perDay: number[];
  /** Of `perDay`, the changes made through an agent (MCP). */
  agentPerDay: number[];
  /** Changes made over the whole range. */
  total: number;
  /** Of `total`, the changes made through an agent. */
  agentTotal: number;
  /** The agents (API key names, as they were) that made them, most used first. */
  agents: string[];
  /**
   * When they were last signed in on the web, used an agent key or made a
   * change themselves (not through GitHub), or null.
   * Sessions note their use at most once a day, so a web visit can be up to
   * a day later than this.
   */
  lastSeenAt: number | null;
  /** Active lists they own, and the open items in them. */
  lists: number;
  openItems: number;
  /** What they've set up beyond the board. */
  features: {
    /** Agent (MCP) keys they hold. */
    agentKeys: number;
    push: boolean;
    emailIn: boolean;
    calendars: boolean;
    /** Someone has joined one of their active lists, they've joined someone else's, or they share a Space. */
    sharing: boolean;
    twoFactor: boolean;
  };
  /** When they last made a change, ever, or null if they never have. */
  lastActiveAt: number | null;
}

export interface DailyUsage {
  /** When it was counted. */
  now: number;
  /** The days covered, oldest first, as YYYY-MM-DD in `timeZone`. */
  days: string[];
  /** Everyone, most active over the range first, then newest signup first. */
  users: UserUsage[];
}

const DAY_MS = 86_400_000;
// Rows are counted in quarter-hour slots in SQL, then slots are put in days
// here: every time zone's midnight falls on a quarter hour.
const SLOT_MS = 15 * 60_000;

/** The YYYY-MM-DD `ts` falls on in `timeZone`. */
function dayKey(ts: number, format: Intl.DateTimeFormat): string {
  return format.format(ts); // en-CA formats as YYYY-MM-DD
}

/** The `days` days ending today in `timeZone`, oldest first. */
function dayKeys(now: number, days: number, format: Intl.DateTimeFormat): string[] {
  // Count back on the calendar rather than in 24-hour steps, which a
  // daylight-saving change would make skip or repeat a day.
  const today = new Date(`${dayKey(now, format)}T00:00:00Z`).getTime();
  return Array.from({ length: days }, (_, i) =>
    new Date(today - (days - 1 - i) * DAY_MS).toISOString().slice(0, 10),
  );
}

export function dailyUsage(
  db: Db,
  { days, timeZone, now = Date.now() }: { days: number; timeZone: string; now?: number },
): DailyUsage {
  const format = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const keys = dayKeys(now, days, format);
  const index = new Map(keys.map((key, i) => [key, i]));

  // A day more than the range, so the first day is covered in any time zone;
  // slots outside the range fall out when they're put in days.
  const since = now - (days + 1) * DAY_MS;
  // Inlined, not bound: a bound number reaches SQLite as a real, which would
  // make this a float division and every change its own slot.
  const slot = sql<number>`${auditLog.ts} / ${sql.raw(String(SLOT_MS))}`;
  // A cross join keeps SQLite going person by person, seeking each one's
  // range on the (actor, ts) index, rather than reading the whole log.
  // Starting from users also leaves out the system actor and deleted people.
  const slots = db
    .select({
      actor: auditLog.actor,
      slot,
      n: count(),
      agent: sql<number>`sum(${auditLog.source} = 'mcp')`,
      agentName: auditLog.agentName,
    })
    .from(users)
    .crossJoin(auditLog)
    // Only what they did themselves: the GitHub integration makes changes in
    // their name while they're away.
    .where(and(eq(auditLog.actor, users.id), gte(auditLog.ts, since), inArray(auditLog.source, ["web", "mcp"])))
    // By agent name too, so the agents come from the counted days only.
    .groupBy(auditLog.actor, slot, auditLog.agentName)
    .all();
  const agentCounts = new Map<string, Map<string, number>>();
  const perDay = new Map<string, { all: number[]; agent: number[] }>();
  for (const { actor, slot, n, agent, agentName } of slots) {
    const i = index.get(dayKey(slot * SLOT_MS, format));
    if (i === undefined) continue;
    let counts = perDay.get(actor);
    if (!counts) perDay.set(actor, (counts = { all: Array(days).fill(0), agent: Array(days).fill(0) }));
    counts.all[i] += n;
    counts.agent[i] += agent;
    // The name is a snapshot, so a revoked or renamed key still shows as it was.
    if (agent && agentName) {
      const names = agentCounts.get(actor) ?? new Map<string, number>();
      agentCounts.set(actor, names.set(agentName, (names.get(agentName) ?? 0) + agent));
    }
  }
  const agents = new Map(
    [...agentCounts].map(([actor, names]) => [
      actor,
      [...names].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name),
    ]),
  );

  // Sessions and keys are a few rows per person: one pass over each.
  const seen = new Map<string, number>();
  const see = (userId: string, ts: number | null) => {
    if (ts !== null && ts > (seen.get(userId) ?? 0)) seen.set(userId, ts);
  };
  for (const { userId, ts } of db
    .select({ userId: sessions.userId, ts: max(sessions.updatedAt) })
    .from(sessions)
    .groupBy(sessions.userId)
    .all()) {
    see(userId, ts?.getTime() ?? null);
  }
  for (const { userId, ts } of db
    .select({ userId: apiKeys.userId, ts: max(apiKeys.lastUsedAt) })
    .from(apiKeys)
    .groupBy(apiKeys.userId)
    .all()) {
    see(userId, ts?.getTime() ?? null);
  }

  // Counted for everyone in one grouped pass each, rather than once per person.
  const lists = new Map(
    db
      .select({
        userId: projects.userId,
        lists: sql<number>`count(distinct ${projects.id})`,
        open: sql<number>`count(${items.id})`,
      })
      .from(projects)
      .leftJoin(items, and(eq(items.projectId, projects.id), isNull(items.completedAt)))
      .where(eq(projects.status, "active"))
      .groupBy(projects.userId)
      .all()
      .map(({ userId, ...counts }) => [userId, counts]),
  );
  // Owners of a list someone has joined.
  const sharedOwners = new Set(
    db
      .selectDistinct({ userId: projects.userId })
      .from(projectMembers)
      .innerJoin(projects, eq(projects.id, projectMembers.projectId))
      .where(and(eq(projectMembers.status, "accepted"), eq(projects.status, "active")))
      .all()
      .map(({ userId }) => userId),
  );

  const rows = db
    .select({
      id: users.id,
      name: users.name,
      username: users.displayUsername,
      email: users.email,
      image: users.image,
      createdAt: users.createdAt,
      // Each person's last change, from the (actor, ts) index. Spelled out:
      // drizzle leaves out the table name, and "id" in here is audit_log's.

      // Their last change made by them, on the web or through an agent: the
      // GitHub integration's changes are made in their name while they're away.
      lastActiveAt: sql<number | null>`(select max("ts") from "audit_log"
        where "actor" = "users"."id" and "source" in ('web', 'mcp'))`,
      // What they've set up, each a lookup by user on its table's index.
      // Spelled out for the same reason.
      agentKeys: sql<number>`(select count(*) from "api_keys" where "user_id" = "users"."id")`,
      push: sql<number>`exists (select 1 from "push_subscriptions" where "user_id" = "users"."id")`,
      emailIn: sql<number>`exists (select 1 from "email_addresses" where "user_id" = "users"."id")`,
      calendars: sql<number>`exists (select 1 from "calendar_accounts" where "user_id" = "users"."id")`,
      sharing: sql<number>`(
        exists (select 1 from "project_members" join "projects" on "projects"."id" = "project_members"."project_id"
          where "project_members"."user_id" = "users"."id" and "project_members"."status" = 'accepted' and "projects"."status" = 'active')
        or exists (select 1 from "space_members" as "mine" join "space_members" as "other"
          on "other"."space_id" = "mine"."space_id" and "other"."user_id" != "mine"."user_id"
          where "mine"."user_id" = "users"."id" and "mine"."status" = 'accepted' and "other"."status" = 'accepted')
      )`,
      twoFactor: users.twoFactorEnabled,
    })
    .from(users)
    .orderBy(asc(users.createdAt))
    .all()
    .map(({ agentKeys, push, emailIn, calendars, sharing, twoFactor, ...user }): UserUsage => {
      const counts = perDay.get(user.id) ?? { all: Array(days).fill(0), agent: Array(days).fill(0) };
      return {
        ...user,
        createdAt: user.createdAt.getTime(),
        joinedOn: dayKey(user.createdAt.getTime(), format),
        perDay: counts.all,
        agentPerDay: counts.agent,
        total: counts.all.reduce((sum, n) => sum + n, 0),
        agentTotal: counts.agent.reduce((sum, n) => sum + n, 0),
        agents: agents.get(user.id) ?? [],
        lists: lists.get(user.id)?.lists ?? 0,
        openItems: lists.get(user.id)?.open ?? 0,
        features: {
          agentKeys,
          push: Boolean(push),
          emailIn: Boolean(emailIn),
          calendars: Boolean(calendars),
          sharing: Boolean(sharing) || sharedOwners.has(user.id),
          twoFactor: Boolean(twoFactor),
        },
        // A change is being seen too, and dates it to the minute.
        lastSeenAt: Math.max(seen.get(user.id) ?? 0, user.lastActiveAt ?? 0) || null,
      };
    })
    .sort((a, b) => b.total - a.total || b.createdAt - a.createdAt);

  return { now, days: keys, users: rows };
}

export interface Cohort {
  /** The first day of the sign-up week, YYYY-MM-DD. */
  week: string;
  /** How many people joined that week. */
  joined: number;
  /**
   * For each week since they joined (0 is the week of joining, counted from
   * each person's own sign-up day): of the people that week has ended for
   * (`of`, ending today counts), how many made a change in it (`kept`).
   * Null while it hasn't ended for any of them.
   */
  active: ({ kept: number; of: number } | null)[];
}

/**
 * Sign-up cohorts: the last `weeks` weeks of `usage.days` (7-day blocks ending
 * today, oldest first), each with how many people joined and how many kept
 * making changes in the weeks after. A person counts towards a week only once
 * it has ended for them (or ends today), so a cohort's latest cell isn't dragged down by
 * days still to come.
 */
export function cohorts(usage: DailyUsage, weeks: number): Cohort[] {
  const { days } = usage;
  const last = days.length - 1;
  const dayIndex = new Map(days.map((day, i) => [day, i]));
  const joined = usage.users.flatMap((user) => {
    const start = dayIndex.get(user.joinedOn);
    return start === undefined ? [] : [{ user, start }];
  });
  // Only whole weeks inside the range.
  weeks = Math.min(weeks, Math.floor(days.length / 7));
  return Array.from({ length: weeks }, (_, w) => {
    const from = days.length - 7 * (weeks - w);
    const members = joined.filter(({ start }) => start >= from && start < from + 7);
    const active = Array.from({ length: weeks - w }, (_, k) => {
      let done = 0;
      let kept = 0;
      for (const { user, start } of members) {
        const end = start + 7 * k + 6;
        if (end > last) continue;
        done++;
        if (user.perDay.slice(start + 7 * k, end + 1).some(Boolean)) kept++;
      }
      return done ? { kept, of: done } : null;
    });
    return { week: days[from], joined: members.length, active };
  });
}
