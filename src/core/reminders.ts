import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { addDays, dayOf } from "../lib/time";
import { users } from "./auth-schema";
import type { Db } from "./db";
import { items, type NotificationLevel, notificationSettings, notifications, projects } from "./schema";

// Due reminders: each morning, a notification to each assignee of an open
// item due that day ("due-today"), and once more the morning after if it's
// still open ("overdue"). Not a change anyone made, so not audited: the
// row names the item, not an audit row. Written once a person's day reaches
// REMIND_HOUR in their time zone, by a job the notification sender runs.

const REMIND_HOUR = 8;

/** The hour (0 to 23) it is at `now` in `timeZone`. */
function hourIn(now: number, timeZone: string): number {
  const hour = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "numeric", hourCycle: "h23" })
    .formatToParts(new Date(now))
    .find((p) => p.type === "hour")?.value;
  return Number(hour);
}

/**
 * How `userId` hears due reminders: "all" pushes them (also with nothing
 * set), "default" keeps them to the inbox, "mine" turns them off.
 */
export function reminderLevel(db: Db, userId: string): NotificationLevel {
  return (
    db
      .select({ level: notificationSettings.level })
      .from(notificationSettings)
      .where(and(eq(notificationSettings.userId, userId), eq(notificationSettings.scope, "reminders")))
      .get()?.level ?? "all"
  );
}

/**
 * Write the due reminders that are due by `now`, each once. Safe to run
 * as often as you like. Returns how many it wrote.
 */
// audit-exempt: reminders are derived from items, not a change anyone made.
export function remindDue(db: Db, now = Date.now()): number {
  // Open items with a due date, in lists still in use.
  const due = db
    .select({ id: items.id, dueDate: items.dueDate, assigneeIds: items.assigneeIds })
    .from(items)
    .innerJoin(projects, eq(projects.id, items.projectId))
    .where(and(isNull(items.completedAt), isNotNull(items.dueDate), eq(projects.status, "active")))
    .all()
    .filter((i) => i.assigneeIds.length > 0);
  const people = [...new Set(due.flatMap((i) => i.assigneeIds))];
  if (people.length === 0) return 0;
  const zones = new Map(
    db
      .select({ id: users.id, timeZone: users.timeZone })
      .from(users)
      .where(inArray(users.id, people))
      .all()
      .map((u) => [u.id, u.timeZone ?? "UTC"]),
  );
  const rows: (typeof notifications.$inferInsert)[] = [];
  for (const userId of people) {
    const timeZone = zones.get(userId);
    if (!timeZone || hourIn(now, timeZone) < REMIND_HOUR) continue;
    const level = reminderLevel(db, userId);
    if (level === "mine") continue;
    const today = dayOf(now, timeZone);
    const groupKey = `due:${today}`;
    const sent = new Set(
      db
        .select({ itemId: notifications.itemId })
        .from(notifications)
        .where(and(eq(notifications.userId, userId), eq(notifications.groupKey, groupKey)))
        .all()
        .map((n) => n.itemId),
    );
    for (const item of due) {
      if (!item.assigneeIds.includes(userId) || sent.has(item.id)) continue;
      const reason =
        item.dueDate === today ? "due-today" : item.dueDate === addDays(today, -1) ? "overdue" : null;
      if (!reason) continue;
      rows.push({
        id: nanoid(12),
        userId,
        reason,
        itemId: item.id,
        groupKey,
        createdAt: now,
        // Inbox only: marked sent, so the sender passes it by.
        sentAt: level === "default" ? now : null,
      });
    }
  }
  if (rows.length) db.insert(notifications).values(rows).run();
  return rows.length;
}
