import type Database from "better-sqlite3";
import { addDays, dayOf, weekday } from "../lib/time";

/** A zone Intl knows, else UTC: a bad one stored for someone mustn't break every read. */
export function validZone(timeZone: unknown): string {
  if (typeof timeZone !== "string" || !timeZone) return "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

/**
 * SQL functions for days in someone's own time zone, with the 4am turnover,
 * which SQLite can't work out itself. hasItemAccess uses them to keep a
 * membership to someone's today or week. Register them on every connection.
 *
 * - `st_day(ms, tz)`: the day a moment fell on, "YYYY-MM-DD".
 * - `st_today(tz)`: today there.
 * - `st_week_start(tz)`: the Monday of this week there.
 */
export function registerDbFunctions(sqlite: Database.Database): void {
  sqlite.function("st_day", { deterministic: true }, (ms: unknown, tz: unknown) =>
    typeof ms === "number" || typeof ms === "bigint" ? dayOf(Number(ms), validZone(tz)) : null,
  );
  // Not deterministic: they read the clock.
  sqlite.function("st_today", (tz: unknown) => dayOf(Date.now(), validZone(tz)));
  sqlite.function("st_week_start", (tz: unknown) => {
    const today = dayOf(Date.now(), validZone(tz));
    return addDays(today, -((weekday(today) + 6) % 7));
  });
}
