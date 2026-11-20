// The Agenda's Get started stack: a few steps that make Sidetrack part of
// someone's day. Each step's progress is read from what the user has done
// (their lists, the audit log, their API keys and push devices), so it can't
// drift from the data and people who did a step before the stack existed get
// it ticked. The one fact nothing else records, that the app was installed,
// is an audited `profile.installed` event. How the stack is left (which cards
// went to the back, whether it's collapsed) is view state on the user's row.

import { and, count, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { apiKeys, users } from "./auth-schema";
import { type AuditOrigin, recordAudit } from "./audit";
import { announceChange } from "./changes";
import type { Db } from "./db";
import type { InstallPlatform } from "./events";
import {
  GET_STARTED_STEPS,
  type GetStarted,
  type GetStartedStep,
} from "../lib/getStarted";
import { auditLog, projects, pushSubscriptions } from "./schema";

/** Lists a user needs before "Set up your lists" is done. */
export const GET_STARTED_MIN_LISTS = 2;

interface Saved {
  later: GetStartedStep[];
  collapsed: boolean;
}

const isStep = (v: unknown): v is GetStartedStep =>
  typeof v === "string" && (GET_STARTED_STEPS as readonly string[]).includes(v);

function readSaved(db: Db, userId: string): Saved {
  const raw = db
    .select({ saved: users.getStarted })
    .from(users)
    .where(eq(users.id, userId))
    .get()?.saved as { later?: unknown; collapsed?: unknown } | null | undefined;
  const later = Array.isArray(raw?.later) ? raw.later.filter(isStep) : [];
  return { later: [...new Set(later)], collapsed: raw?.collapsed === true };
}

function writeSaved(db: Db, userId: string, saved: Saved): void {
  // audit-exempt: view state, not a change to anything shown to others.
  db.update(users).set({ getStarted: saved }).where(eq(users.id, userId)).run();
  // Unaudited, so announced here: the user's other tabs and devices follow.
  announceChange({ actor: userId, projectId: null });
}

/** The platforms the user has installed the app on, from the audit log. */
function installedPlatforms(db: Db, userId: string): Set<InstallPlatform> {
  const rows = db
    .select({ platform: sql<string>`json_extract(${auditLog.event}, '$.platform')` })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.actor, userId),
        eq(auditLog.entityType, "profile"),
        sql`json_extract(${auditLog.event}, '$.type') = 'profile.installed'`,
      ),
    )
    .all();
  return new Set(rows.map((r) => r.platform as InstallPlatform));
}

/** Whether the user has ever made an audited change of one of these types. */
function hasEvent(db: Db, userId: string, types: string[]): boolean {
  return (
    db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.actor, userId),
          inArray(sql<string>`json_extract(${auditLog.event}, '$.type')`, types),
        ),
      )
      .limit(1)
      .get() !== undefined
  );
}

/** Where the user is with each step, and which card to show first. */
export function getGetStarted(db: Db, userId: string): GetStarted {
  const lists =
    db.select({ n: count() }).from(projects).where(eq(projects.userId, userId)).get()?.n ?? 0;
  const installed = installedPlatforms(db, userId);
  // iOS only sends web push to an installed app, so a push subscription from
  // an iPhone or iPad means it's installed there.
  const iosPush =
    db
      .select({ endpoint: pushSubscriptions.endpoint })
      .from(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.userId, userId),
          inArray(pushSubscriptions.deviceLabel, ["iPhone", "iPad"]),
        ),
      )
      .limit(1)
      .get() !== undefined;
  // A key that has made a call, or a change an agent made, which outlasts
  // the key being revoked.
  const agent =
    db
      .select({ id: apiKeys.id })
      .from(apiKeys)
      .where(and(eq(apiKeys.userId, userId), isNotNull(apiKeys.lastUsedAt)))
      .limit(1)
      .get() !== undefined ||
    db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(and(eq(auditLog.actor, userId), eq(auditLog.source, "mcp")))
      .limit(1)
      .get() !== undefined;

  const done: Record<GetStartedStep, boolean> = {
    lists: lists >= GET_STARTED_MIN_LISTS,
    iphone: installed.has("ios") || iosPush,
    mac: installed.has("macos"),
    // Counts once the invite is sent, whether or not it's accepted.
    share: hasEvent(db, userId, ["member.invited", "space.member.invited"]),
    agent,
  };
  const saved = readSaved(db, userId);
  const open = GET_STARTED_STEPS.filter((step) => !done[step]);
  const queue = [
    ...open.filter((step) => !saved.later.includes(step)),
    ...saved.later.filter((step) => open.includes(step)),
  ];
  return { done, queue, collapsed: saved.collapsed };
}

/**
 * Record that the app opened in its own window on `platform`. A no-op once
 * that platform is recorded, so the app can report it on every launch.
 */
export function recordInstall(
  db: Db,
  userId: string,
  platform: InstallPlatform,
  source: AuditOrigin,
): void {
  if (platform !== "ios" && platform !== "macos") throw new Error("Not a platform");
  // Immediate (write-locked), so two launches at once can't both record it.
  db.transaction(
    (tx) => {
      if (installedPlatforms(tx as unknown as Db, userId).has(platform)) return;
      recordAudit(tx as unknown as Db, {
        actor: userId,
        source,
        event: { type: "profile.installed", userId, platform },
      });
    },
    { behavior: "immediate" },
  );
}

/** Send a card to the back of the stack. */
export function sendGetStartedToBack(db: Db, userId: string, step: GetStartedStep): void {
  if (!isStep(step)) throw new Error("Not a step");
  const saved = readSaved(db, userId);
  writeSaved(db, userId, { ...saved, later: [...saved.later.filter((s) => s !== step), step] });
}

/** Collapse the stack to its progress bar, or open it again. */
export function setGetStartedCollapsed(db: Db, userId: string, collapsed: boolean): void {
  if (typeof collapsed !== "boolean") throw new Error("Not a fold");
  writeSaved(db, userId, { ...readSaved(db, userId), collapsed });
}
