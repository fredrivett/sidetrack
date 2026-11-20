// Calendars someone connected, so the Agenda's brief can see what's on
// (calendar_accounts, calendars, calendar_events in schema.ts). iCloud over
// CalDAV for now: the person makes an app-specific password, Sidetrack signs
// in, finds their calendars and keeps a copy of each included one's events
// from yesterday to a fortnight ahead, synced every SYNC_EVERY_MS. Every
// device reads that one copy.
//
// The password is sealed with CALENDAR_SECRET_KEY (lib/secretBox.ts) and
// opened only to sync. It's never returned, logged or audited. Connecting,
// disconnecting and including a calendar are audited; sync is a cache of the
// owner's own data, so it isn't. Events are their owner's alone: nothing
// here reads another person's.

import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  CalDavAuthError,
  CalDavError,
  type CalDavOptions,
  fetchEventData,
  findCalendarHome,
  ICLOUD_CALDAV,
  listCalendars,
} from "../lib/caldav";
import { getEnv } from "../lib/env";
import { eventsIn } from "../lib/icsEvents";
import { getPostHog } from "../lib/posthog";
import { openSecret, sealSecret } from "../lib/secretBox";
import { type AuditOrigin, recordAudit } from "./audit";
import { users } from "./auth-schema";
import { announceChange } from "./changes";
import type { Db } from "./db";
import { calendarAccounts, calendarEvents, calendars } from "./schema";

/** How often each account syncs. */
export const SYNC_EVERY_MS = 15 * 60_000;
/** Events are fetched again at least this often, as the window moves on, even when nothing changed. */
const REFETCH_EVERY_MS = 6 * 60 * 60_000;
const DAY_MS = 86_400_000;
/** The events kept: from two days back (yesterday in every zone) to a fortnight ahead. */
const windowAt = (now: number) => ({ from: now - 2 * DAY_MS, to: now + 15 * DAY_MS });

/**
 * What talking to a calendar server needs: the key passwords are sealed
 * with, and, for tests, a stand-in server and the addresses it may use.
 */
export interface CalendarConfig {
  key: Buffer;
  serverUrl?: string;
  allowUrl?: CalDavOptions["allowUrl"];
  allowAddress?: CalDavOptions["allowAddress"];
}

/** This server's calendar config, or null when CALENDAR_SECRET_KEY is unset and calendars are off. */
export function calendarConfig(): CalendarConfig | null {
  const key = getEnv().CALENDAR_SECRET_KEY;
  return key ? { key } : null;
}

/** An account as settings shows it: never its password. */
export interface CalendarAccountView {
  id: string;
  kind: "icloud";
  username: string;
  createdAt: number;
  lastSyncedAt: number | null;
  lastError: string | null;
  needsReconnect: boolean;
  calendars: Array<{ id: string; name: string; color: string | null; included: boolean; events: number }>;
}

/** Something the person can fix, in words for settings: a refused password, say. */
export class CalendarConnectError extends Error {}

const REFUSED = "iCloud didn't accept that Apple ID and app-specific password.";

export function listCalendarAccounts(db: Db, userId: string): CalendarAccountView[] {
  const accounts = db
    .select()
    .from(calendarAccounts)
    .where(eq(calendarAccounts.userId, userId))
    .orderBy(calendarAccounts.createdAt)
    .all();
  if (accounts.length === 0) return [];
  const cals = db
    .select()
    .from(calendars)
    .where(
      inArray(
        calendars.accountId,
        accounts.map((a) => a.id),
      ),
    )
    .orderBy(calendars.name)
    .all();
  const counts = new Map<string, number>();
  for (const e of db
    .select({ calendarId: calendarEvents.calendarId })
    .from(calendarEvents)
    .where(
      inArray(
        calendarEvents.calendarId,
        cals.map((c) => c.id),
      ),
    )
    .all()) {
    counts.set(e.calendarId, (counts.get(e.calendarId) ?? 0) + 1);
  }
  return accounts.map((a) => ({
    id: a.id,
    kind: a.kind,
    username: a.username,
    createdAt: a.createdAt,
    lastSyncedAt: a.lastSyncedAt,
    lastError: a.lastError,
    needsReconnect: a.needsReconnect,
    calendars: cals
      .filter((c) => c.accountId === a.id)
      .map((c) => ({ id: c.id, name: c.name, color: c.color, included: c.included, events: counts.get(c.id) ?? 0 })),
  }));
}

const davOptions = (config: CalendarConfig, username: string, password: string): CalDavOptions => ({
  username,
  password,
  allowUrl: config.allowUrl,
  allowAddress: config.allowAddress,
});

/**
 * Sign in to iCloud with an Apple ID and app-specific password, and save the
 * account with the calendars it finds, then sync it. Connecting an Apple ID
 * that's already connected signs it in again with the new password.
 * Throws CalendarConnectError, with words for the person, when iCloud
 * refuses or can't be reached; nothing is saved then.
 */
export async function connectICloud(
  db: Db,
  userId: string,
  input: { username: string; password: string },
  source: AuditOrigin,
  config: CalendarConfig,
): Promise<CalendarAccountView> {
  const username = input.username.trim();
  // Apple shows them as xxxx-xxxx-xxxx-xxxx; spaces from a copy don't belong.
  const password = input.password.replace(/\s+/g, "");
  if (!username || !password) throw new CalendarConnectError("Enter your Apple ID and an app-specific password.");
  const opts = davOptions(config, username, password);
  let homeUrl: string;
  let found: Awaited<ReturnType<typeof listCalendars>>;
  try {
    homeUrl = await findCalendarHome(config.serverUrl ?? ICLOUD_CALDAV, opts);
    found = await listCalendars(homeUrl, opts);
  } catch (error) {
    if (error instanceof CalDavAuthError) throw new CalendarConnectError(REFUSED);
    getPostHog()?.captureException(error);
    throw new CalendarConnectError("Couldn't reach iCloud. Please try again.");
  }
  const existing = db
    .select()
    .from(calendarAccounts)
    .where(and(eq(calendarAccounts.userId, userId), eq(calendarAccounts.username, username)))
    .get();
  const id = existing?.id ?? nanoid(12);
  const now = Date.now();
  const secret = sealSecret(password, config.key, id);
  db.transaction((tx) => {
    if (existing) {
      tx.update(calendarAccounts)
        .set({ secret, homeUrl, needsReconnect: false, lastError: null })
        .where(eq(calendarAccounts.id, id))
        .run();
    } else {
      tx.insert(calendarAccounts)
        .values({ id, userId, kind: "icloud", username, secret, homeUrl, createdAt: now })
        .run();
    }
    keepCalendars(tx as unknown as Db, id, found, now, true);
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      event: { type: existing ? "calendar.reconnected" : "calendar.connected", accountId: id, username },
    });
  });
  await syncCalendarAccount(db, id, config, now);
  const view = listCalendarAccounts(db, userId).find((a) => a.id === id);
  if (!view) throw new Error(`calendar account not found after connecting: ${id}`);
  return view;
}

/** Remove an account, its calendars and their events. False when it isn't theirs. */
export function disconnectCalendarAccount(db: Db, userId: string, accountId: string, source: AuditOrigin): boolean {
  const account = db
    .select()
    .from(calendarAccounts)
    .where(and(eq(calendarAccounts.id, accountId), eq(calendarAccounts.userId, userId)))
    .get();
  if (!account) return false;
  db.transaction((tx) => {
    // Its calendars and events go with it (on delete cascade).
    tx.delete(calendarAccounts).where(eq(calendarAccounts.id, accountId)).run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      event: { type: "calendar.disconnected", accountId, username: account.username },
    });
  });
  return true;
}

/**
 * Include one of their calendars, or leave it out. Leaving it out drops its
 * events at once; including it fetches them next sync. False when it isn't
 * theirs; true, without a row, when it already was so.
 */
export function setCalendarIncluded(
  db: Db,
  userId: string,
  calendarId: string,
  included: boolean,
  source: AuditOrigin,
): boolean {
  const cal = db
    .select({ id: calendars.id, name: calendars.name, included: calendars.included, accountId: calendars.accountId })
    .from(calendars)
    .innerJoin(calendarAccounts, eq(calendarAccounts.id, calendars.accountId))
    .where(and(eq(calendars.id, calendarId), eq(calendarAccounts.userId, userId)))
    .get();
  if (!cal) return false;
  if (cal.included === included) return true;
  db.transaction((tx) => {
    tx.update(calendars).set({ included, ctag: null, eventsFetchedAt: null }).where(eq(calendars.id, calendarId)).run();
    if (!included) tx.delete(calendarEvents).where(eq(calendarEvents.calendarId, calendarId)).run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      event: { type: "calendar.included", accountId: cal.accountId, calendarId, name: cal.name, included },
    });
  });
  return true;
}

/** Calendars are matched by path: iCloud may move an account to another of its hosts. */
const pathOf = (url: string) => new URL(url).pathname;

/**
 * Bring an account's calendars in line with what its server lists: new ones
 * added (included, unless they're birthdays), names, colours and hosts
 * updated. With `prune` (connecting, which the caller audits), ones it no
 * longer lists are removed. Sync never removes one or touches whether it's
 * included, which is the owner's choice: a calendar missing from one answer
 * only loses its copied events, and comes back as it was.
 */
// audit-exempt: the server's own list of calendars, kept in step; connecting audits in the caller's transaction.
function keepCalendars(
  db: Db,
  accountId: string,
  found: Awaited<ReturnType<typeof listCalendars>>,
  now: number,
  prune: boolean,
) {
  const known = new Map(
    db.select().from(calendars).where(eq(calendars.accountId, accountId)).all().map((c) => [pathOf(c.remoteUrl), c]),
  );
  for (const remote of found) {
    const row = known.get(pathOf(remote.url));
    known.delete(pathOf(remote.url));
    if (row) {
      if (row.name !== remote.name || row.color !== remote.color || row.remoteUrl !== remote.url) {
        db.update(calendars)
          .set({ name: remote.name, color: remote.color, remoteUrl: remote.url })
          .where(eq(calendars.id, row.id))
          .run();
      }
    } else {
      db.insert(calendars)
        .values({
          id: nanoid(12),
          accountId,
          remoteUrl: remote.url,
          name: remote.name,
          color: remote.color,
          included: !/birthday/i.test(remote.name),
          createdAt: now,
        })
        .run();
    }
  }
  for (const gone of known.values()) {
    if (prune) db.delete(calendars).where(eq(calendars.id, gone.id)).run();
    else {
      db.delete(calendarEvents).where(eq(calendarEvents.calendarId, gone.id)).run();
      db.update(calendars).set({ ctag: null, eventsFetchedAt: null }).where(eq(calendars.id, gone.id)).run();
    }
  }
}

/**
 * Replace a calendar's copy of its events with `found`, fetched at `now`
 * with `ctag`, unless it was left out or removed while they were fetched.
 * Run in a transaction, unaudited, so the copy is never half replaced.
 */
// audit-exempt: a cache of the owner's own calendar, rebuilt by sync; nobody made a change here.
function replaceEvents(tx: Db, calendarId: string, found: ReturnType<typeof eventsIn>, ctag: string | null, now: number): boolean {
  const still = tx.select({ included: calendars.included }).from(calendars).where(eq(calendars.id, calendarId)).get();
  if (!still?.included) return false;
  tx.delete(calendarEvents).where(eq(calendarEvents.calendarId, calendarId)).run();
  for (const e of found) tx.insert(calendarEvents).values({ id: nanoid(12), calendarId, ...e }).run();
  tx.update(calendars).set({ ctag, eventsFetchedAt: now }).where(eq(calendars.id, calendarId)).run();
  return true;
}

/**
 * Note how an account's sync went: what went wrong if anything did, when it
 * finished (`at`; left as it was for a sync that didn't), and whether it
 * needs signing in again.
 */
// audit-exempt: sync status, not a change anyone made.
function noteSync(db: Db, accountId: string, result: { error: string | null; at?: number; reconnect?: true }) {
  db.update(calendarAccounts)
    .set({
      lastError: result.error,
      ...(result.at !== undefined && { lastSyncedAt: result.at }),
      ...(result.reconnect && { needsReconnect: true }),
    })
    .where(eq(calendarAccounts.id, accountId))
    .run();
}

const syncError = (error: unknown) =>
  error instanceof CalDavError ? `Couldn't sync: ${error.message}.` : "Couldn't reach iCloud; Sidetrack will try again.";

/**
 * Fetch an account's calendars, and the events of each included one whose
 * ctag changed or that wasn't fetched for REFETCH_EVERY_MS. A refused
 * password stops sync until they reconnect. A calendar that fails is noted
 * and tried again next time, without holding up the others. Announces a
 * change when events changed, so an open Agenda reloads. Never throws for
 * the server's sake.
 */
export async function syncCalendarAccount(db: Db, accountId: string, config: CalendarConfig, now = Date.now()) {
  const account = db
    .select({ a: calendarAccounts, email: users.email, timeZone: users.timeZone })
    .from(calendarAccounts)
    .innerJoin(users, eq(users.id, calendarAccounts.userId))
    .where(eq(calendarAccounts.id, accountId))
    .get();
  if (!account || account.a.needsReconnect) return;
  const { a } = account;
  let password: string;
  try {
    password = openSecret(a.secret, config.key, a.id);
  } catch {
    noteSync(db, a.id, { error: "Sidetrack can't read the saved password any more. Please sign in again.", reconnect: true });
    return;
  }
  const opts = davOptions(config, a.username, password);
  let changed = false;
  let failed: string | null = null;
  try {
    const found = await listCalendars(a.homeUrl, opts);
    // An answer listing nothing is more likely a glitch than every calendar gone.
    if (found.length === 0) throw new CalDavError("iCloud listed no calendars");
    keepCalendars(db, a.id, found, now, false);
    const ctags = new Map(found.map((c) => [pathOf(c.url), c.ctag]));
    const due = db
      .select()
      .from(calendars)
      .where(and(eq(calendars.accountId, a.id), eq(calendars.included, true)))
      .all()
      .filter((c) => {
        const path = pathOf(c.remoteUrl);
        if (!ctags.has(path)) return false;
        const ctag = ctags.get(path) ?? null;
        return ctag === null || ctag !== c.ctag || c.eventsFetchedAt === null || c.eventsFetchedAt < now - REFETCH_EVERY_MS;
      });
    const window = windowAt(now);
    for (const cal of due) {
      try {
        const data = await fetchEventData(cal.remoteUrl, window, opts);
        const events = eventsIn(data, window, {
          addresses: [a.username, account.email],
          fallbackZone: account.timeZone ?? "UTC",
        });
        const ctag = ctags.get(pathOf(cal.remoteUrl)) ?? null;
        if (db.transaction((tx) => replaceEvents(tx as unknown as Db, cal.id, events, ctag, now))) changed = true;
      } catch (error) {
        if (error instanceof CalDavAuthError) throw error;
        getPostHog()?.captureException(error);
        failed ??= syncError(error);
      }
    }
    noteSync(db, a.id, { at: now, error: failed });
  } catch (error) {
    if (error instanceof CalDavAuthError) {
      noteSync(db, a.id, { error: "iCloud refused the password; it may have been revoked. Please sign in again.", reconnect: true });
    } else {
      getPostHog()?.captureException(error);
      // Not a sync: the account keeps its last good time, and the error says why.
      noteSync(db, a.id, { error: syncError(error) });
    }
  }
  if (changed) announceChange({ actor: a.userId, projectId: null });
}

/** When each account was last tried, so a failing one waits SYNC_EVERY_MS too. */
const lastTried = new Map<string, number>();

/** Sync every account that's due, one at a time. */
export async function syncDueCalendars(db: Db, config: CalendarConfig, now = Date.now()) {
  const due = db
    .select({ id: calendarAccounts.id })
    .from(calendarAccounts)
    .where(
      and(
        eq(calendarAccounts.needsReconnect, false),
        or(isNull(calendarAccounts.lastSyncedAt), lt(calendarAccounts.lastSyncedAt, now - SYNC_EVERY_MS + 60_000)),
      ),
    )
    .all();
  for (const { id } of due) {
    if ((lastTried.get(id) ?? -Infinity) > now - SYNC_EVERY_MS + 60_000) continue;
    lastTried.set(id, now);
    // Each at its own time: the ones before may have taken a while.
    await syncCalendarAccount(db, id, config);
  }
}

declare global {
  var __sidetrackCalendarSync: boolean | undefined;
}

/** Sync calendars in the background, every minute checking which are due. Once per process. */
export function startCalendarSync(db: Db, config: CalendarConfig): void {
  if (globalThis.__sidetrackCalendarSync) return;
  globalThis.__sidetrackCalendarSync = true;
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    syncDueCalendars(db, config)
      .catch((error) => getPostHog()?.captureException(error))
      .finally(() => {
        running = false;
      });
  };
  setInterval(tick, 60_000).unref();
  tick();
}
