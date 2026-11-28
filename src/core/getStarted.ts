// The Agenda's Get started stack: a few steps that make Sidetrack part of
// someone's day. Each step's progress is read from what the user has done
// (their lists and items, who they share with, two-factor sign-in, the audit
// log, their API keys and push devices), so it can't drift from the data and people who did a step before
// the stack existed get it ticked. The one fact nothing else records, that the app was installed,
// is an audited `profile.installed` event. How the stack is left (which cards
// went to the back, whether it's collapsed) is view state on the user's row.

import { type SQL, and, count, eq, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { apiKeys, users } from "./auth-schema";
import { type AuditOrigin, recordAudit } from "./audit";
import { announceChange } from "./changes";
import type { Db } from "./db";
import {
  GET_STARTED_STEPS,
  type GetStarted,
  type GetStartedStep,
  INSTALL_PLATFORMS,
  type InstallPlatform,
} from "../lib/getStarted";
import { canEditProject } from "./access";
import { handleFor } from "./members";
import {
  auditLog,
  items,
  labels,
  projectMembers,
  projects,
  pushSubscriptions,
  spaceMembers,
} from "./schema";

/** Items of the user's own before labels are offered: enough to want to group. */
export const LABEL_AFTER_ITEMS = 5;
/** Items, or days since signing up, before securing the account is offered. */
export const SECURE_AFTER_ITEMS = 10;
export const SECURE_AFTER_DAYS = 7;

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

const others = alias(spaceMembers, "others");

/**
 * Whether the user shares a list or Space with someone who has accepted, in
 * either direction: they invited them, or were invited. Read from who's in
 * what now, so it unticks if everyone else leaves.
 */
function isSharing(db: Db, userId: string): boolean {
  const inSpace = db
    .select({ id: spaceMembers.id })
    .from(spaceMembers)
    .innerJoin(
      others,
      and(
        eq(others.spaceId, spaceMembers.spaceId),
        ne(others.userId, spaceMembers.userId),
        eq(others.status, "accepted"),
      ),
    )
    .where(and(eq(spaceMembers.userId, userId), eq(spaceMembers.status, "accepted")))
    .limit(1)
    .get();
  if (inSpace) return true;
  // A list's owner is never its member, so an accepted member row is always
  // two people: the user joined someone's list, or someone joined theirs.
  const onList = db
    .select({ id: projectMembers.id })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(
      and(
        eq(projectMembers.status, "accepted"),
        or(eq(projectMembers.userId, userId), eq(projects.userId, userId)),
      ),
    )
    .limit(1)
    .get();
  return onList !== undefined;
}

const admins = alias(spaceMembers, "admins");

/**
 * Who hasn't yet accepted an invite to the user's lists, or to a Space they
 * manage, as handles, oldest first.
 */
function pendingInvitees(db: Db, userId: string): string[] {
  const toLists = db
    .select({ id: users.id, username: users.username, at: projectMembers.createdAt })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(and(eq(projects.userId, userId), eq(projectMembers.status, "pending")))
    .all();
  const toSpaces = db
    .select({ id: users.id, username: users.username, at: spaceMembers.createdAt })
    .from(spaceMembers)
    .innerJoin(
      admins,
      and(
        eq(admins.spaceId, spaceMembers.spaceId),
        eq(admins.userId, userId),
        eq(admins.role, "admin"),
        eq(admins.status, "accepted"),
      ),
    )
    .innerJoin(users, eq(users.id, spaceMembers.userId))
    .where(eq(spaceMembers.status, "pending"))
    .all();
  const people = [...toLists, ...toSpaces].sort((x, y) => x.at - y.at);
  return [...new Set(people.map((p) => handleFor(p, p.id)))];
}

/** Items the user added, or that are in a list they own: the board they've set up. */
const ownItem = (userId: string) => or(eq(items.createdBy, userId), eq(projects.userId, userId));

/** Whether one of the user's own items (ownItem) matches `where`. */
function hasItem(db: Db, userId: string, where: SQL): boolean {
  return (
    db
      .select({ id: items.id })
      .from(items)
      .innerJoin(projects, eq(projects.id, items.projectId))
      .where(and(ownItem(userId), where))
      .limit(1)
      .get() !== undefined
  );
}

/**
 * Where the user is with each step, and which card to show first. `push` says
 * whether this server can send notifications (VAPID keys set); without it the
 * notifications step isn't offered.
 */
export function getGetStarted(
  db: Db,
  userId: string,
  { push = true }: { push?: boolean } = {},
): GetStarted {
  const ownsList =
    db.select({ id: projects.id }).from(projects).where(eq(projects.userId, userId)).limit(1).get() !==
    undefined;
  // A list they can add items to: their own, or one shared with them to edit.
  // Someone invited to a list starts from it, without making one first.
  const canAdd =
    ownsList ||
    db
      .select({ id: projects.id })
      .from(projects)
      .where(and(canEditProject(userId), eq(projects.status, "active")))
      .limit(1)
      .get() !== undefined;
  const itemCount =
    db
      .select({ n: count() })
      .from(items)
      .innerJoin(projects, eq(projects.id, items.projectId))
      .where(ownItem(userId))
      .get()?.n ?? 0;
  const user = db
    .select({ secure: users.twoFactorEnabled, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  const daysIn = user ? (Date.now() - user.createdAt.getTime()) / 86_400_000 : 0;
  const installed = installedPlatforms(db, userId);
  // iOS only sends web push to an installed app, so a push subscription from
  // an iPhone or iPad means it's on the Home Screen there. (Android sends it
  // to the browser too, so its push devices prove nothing.)
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
    lists: canAdd,
    date: hasItem(db, userId, isNotNull(items.dueDate)),
    repeat: hasItem(db, userId, isNotNull(items.repeatEvery)),
    // A label on an item, or one made in List details before using it.
    label:
      hasItem(db, userId, ne(items.labels, sql`'[]'`)) ||
      db
        .select({ id: labels.id })
        .from(labels)
        .innerJoin(projects, eq(projects.id, labels.projectId))
        .where(eq(projects.userId, userId))
        .limit(1)
        .get() !== undefined,
    // Any device, phone or computer. Unticks if they turn them all off.
    notifications:
      db
        .select({ endpoint: pushSubscriptions.endpoint })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, userId))
        .limit(1)
        .get() !== undefined,
    // Unticks if they turn it off again.
    secure: user?.secure === true,
    phone: installed.has("phone") || iosPush,
    computer: installed.has("computer"),
    share: isSharing(db, userId),
    agent,
  };
  // Each step waits until it's useful, so a new account starts with one:
  // most need a list to put things in, sharing a list of their own, and
  // repeats and nudges something with a date. Labels wait for enough items to
  // group, and securing the account for something worth protecting. A step
  // that's done always shows, ticked.
  const waitsFor: Partial<Record<GetStartedStep, boolean>> = {
    date: done.lists,
    phone: done.lists,
    computer: done.lists,
    agent: done.lists,
    share: ownsList,
    repeat: done.date,
    notifications: push && done.date,
    label: itemCount >= LABEL_AFTER_ITEMS,
    secure: itemCount >= SECURE_AFTER_ITEMS || daysIn >= SECURE_AFTER_DAYS,
  };
  const steps = GET_STARTED_STEPS.filter((step) => done[step] || (waitsFor[step] ?? true));
  const saved = readSaved(db, userId);
  const open = steps.filter((step) => !done[step]);
  const queue = [
    ...open.filter((step) => !saved.later.includes(step)),
    ...saved.later.filter((step) => open.includes(step)),
  ];
  return {
    steps,
    done,
    queue,
    collapsed: saved.collapsed,
    pendingInvites: done.share ? [] : pendingInvitees(db, userId),
  };
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
  if (!(INSTALL_PLATFORMS as readonly string[]).includes(platform)) throw new Error("Not a platform");
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
