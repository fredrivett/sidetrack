import { and, asc, count, eq, gte, max, sql } from "drizzle-orm";
import { apiKeys, sessions, users } from "./auth-schema";
import type { Db } from "./db";
import { auditLog } from "./schema";

// How much each person uses Sidetrack, for the admin view: the changes they
// made (audit rows, from the web or through an agent) on each day.

export interface UserUsage {
  id: string;
  name: string;
  username: string;
  email: string;
  image: string | null;
  createdAt: number;
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
   * When they were last signed in on the web or used an agent key, or null.
   * Sessions note their use at most once a day, so a web visit can be up to
   * a day later than this.
   */
  lastSeenAt: number | null;
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
    })
    .from(users)
    .crossJoin(auditLog)
    .where(and(eq(auditLog.actor, users.id), gte(auditLog.ts, since)))
    .groupBy(auditLog.actor, slot)
    .all();
  const perDay = new Map<string, { all: number[]; agent: number[] }>();
  for (const { actor, slot, n, agent } of slots) {
    const i = index.get(dayKey(slot * SLOT_MS, format));
    if (i === undefined) continue;
    let counts = perDay.get(actor);
    if (!counts) perDay.set(actor, (counts = { all: Array(days).fill(0), agent: Array(days).fill(0) }));
    counts.all[i] += n;
    counts.agent[i] += agent;
  }

  // Which agents made them, from the same rows (the name is a snapshot, so a
  // revoked or renamed key still shows as it was).
  const agents = new Map<string, string[]>();
  for (const { actor, name } of db
    .select({ actor: auditLog.actor, name: auditLog.agentName })
    .from(users)
    .crossJoin(auditLog)
    .where(and(eq(auditLog.actor, users.id), gte(auditLog.ts, now - days * DAY_MS), eq(auditLog.source, "mcp")))
    .groupBy(auditLog.actor, auditLog.agentName)
    .orderBy(sql`count(*) desc`)
    .all()) {
    if (!name) continue;
    agents.set(actor, [...(agents.get(actor) ?? []), name]);
  }

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
      lastActiveAt: sql<number | null>`(select max("ts") from "audit_log" where "actor" = "users"."id")`,
    })
    .from(users)
    .orderBy(asc(users.createdAt))
    .all()
    .map((user): UserUsage => {
      const counts = perDay.get(user.id) ?? { all: Array(days).fill(0), agent: Array(days).fill(0) };
      return {
        ...user,
        createdAt: user.createdAt.getTime(),
        perDay: counts.all,
        agentPerDay: counts.agent,
        total: counts.all.reduce((sum, n) => sum + n, 0),
        agentTotal: counts.agent.reduce((sum, n) => sum + n, 0),
        agents: agents.get(user.id) ?? [],
        // A change is being seen too, and dates it to the minute.
        lastSeenAt: Math.max(seen.get(user.id) ?? 0, user.lastActiveAt ?? 0) || null,
      };
    })
    .sort((a, b) => b.total - a.total || b.createdAt - a.createdAt);

  return { now, days: keys, users: rows };
}
