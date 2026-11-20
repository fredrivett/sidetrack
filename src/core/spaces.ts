import { and, asc, count, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { normalizeProjectIcon } from "../lib/projectIcon";
import { hasProjectAccess } from "./access";
import { parseProjectRef, resolvePosition } from "./fracidx";
import { users } from "./auth-schema";
import { type AuditOrigin, recordAudit } from "./audit";
import type { Db } from "./db";
import { accessLost, type ChangeEvent, type MemberExit } from "./events";
import {
  type CollaboratorView,
  findUserByHandle,
  handleFor,
  personAt,
  revokeListAccess,
  suggestCollaborators,
} from "./members";
import {
  type MembershipStatus,
  projects,
  SPACE_COLORS,
  SPACE_ROLES,
  type SpaceColor,
  type SpaceRole,
  spaceMembers,
  spaces,
} from "./schema";

// Spaces: a group of people who share every list in it. Access to the lists
// comes from hasProjectAccess (an accepted space_members row); this file
// manages the Space and its people. Every accepted member can see and edit
// the Space's lists; admins also invite, remove, change roles, rename and
// delete. The creator starts as the only admin, and a Space always keeps at
// least one. Space-level events are audited with no projectId.

/** A Space as one of its members sees it, with their own role. */
export interface SpaceView {
  id: string;
  name: string;
  icon: string | null;
  color: SpaceColor | null;
  createdBy: string;
  createdAt: number;
  role: SpaceRole;
}

/** Someone in a Space, or invited to it. */
export interface SpaceMemberView {
  userId: string;
  username: string | null;
  displayUsername: string | null;
  name: string | null;
  email: string | null;
  status: MembershipStatus;
  role: SpaceRole;
  createdAt: number;
}

/** A pending Space invite from the invitee's side. */
export interface PendingSpaceInviteView {
  spaceId: string;
  spaceName: string;
  createdAt: number;
}

function membershipOf(db: Db, userId: string, spaceId: string) {
  return db
    .select()
    .from(spaceMembers)
    .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, userId)))
    .get();
}

/** The Space, if `userId` is an accepted member; otherwise a plain not-found,
 * so a stranger learns nothing about it. */
function requireMember(db: Db, userId: string, spaceId: string) {
  const space = db.select().from(spaces).where(eq(spaces.id, spaceId)).get();
  const membership = space && membershipOf(db, userId, spaceId);
  if (!space || membership?.status !== "accepted") {
    throw new Error(`space not found: ${spaceId}`);
  }
  return { space, membership };
}

function requireAdmin(db: Db, userId: string, spaceId: string, what: string) {
  const found = requireMember(db, userId, spaceId);
  if (found.membership.role !== "admin") {
    throw new Error(`only a space admin can ${what}`);
  }
  return found;
}

function adminCount(db: Db, spaceId: string): number {
  return (
    db
      .select({ n: count() })
      .from(spaceMembers)
      .where(
        and(
          eq(spaceMembers.spaceId, spaceId),
          eq(spaceMembers.status, "accepted"),
          eq(spaceMembers.role, "admin"),
        ),
      )
      .get()?.n ?? 0
  );
}

function listIdsInSpace(db: Db, spaceId: string): string[] {
  return db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.spaceId, spaceId))
    .all()
    .map((r) => r.id);
}

function assertColor(color: string | null | undefined): SpaceColor | null {
  // Only null (or leaving it out) clears; "" and other junk are refused.
  if (color === null || color === undefined) return null;
  if (!(SPACE_COLORS as readonly string[]).includes(color)) {
    throw new Error(`unknown space colour: ${color}`);
  }
  return color as SpaceColor;
}

function assertName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("space name cannot be empty");
  return trimmed;
}

/** Create a Space. The creator joins it as its only admin. */
export function createSpace(
  db: Db,
  userId: string,
  input: { name: string; icon?: string | null; color?: SpaceColor | null },
  source: AuditOrigin,
): SpaceView {
  const name = assertName(input.name);
  const icon = input.icon ? normalizeProjectIcon(input.icon) : null;
  const color = assertColor(input.color);
  const id = nanoid(12);
  const now = Date.now();
  db.transaction((tx) => {
    tx.insert(spaces).values({ id, createdBy: userId, name, icon, color, createdAt: now }).run();
    tx.insert(spaceMembers)
      .values({
        id: nanoid(12),
        spaceId: id,
        userId,
        status: "accepted",
        role: "admin",
        position: nextTrayPosition(tx as unknown as Db, userId),
        createdAt: now,
      })
      .run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      event: { type: "space.created", spaceId: id, name, color },
    });
  });
  return { id, name, icon, color, createdBy: userId, createdAt: now, role: "admin" };
}

/** Rename a Space or change its icon or colour (null clears either). Admin-only. */
export function updateSpace(
  db: Db,
  userId: string,
  spaceId: string,
  input: { name?: string; icon?: string | null; color?: SpaceColor | null },
  source: AuditOrigin,
): void {
  const { space } = requireAdmin(db, userId, spaceId, "edit the space");
  const set: { name?: string; icon?: string | null; color?: SpaceColor | null } = {};
  const changes: Extract<ChangeEvent, { type: "space.updated" }>["changes"] = {};
  if (input.name !== undefined) {
    const name = assertName(input.name);
    if (name !== space.name) {
      set.name = name;
      changes.name = { from: space.name, to: name };
    }
  }
  if (input.icon !== undefined) {
    const icon = input.icon ? normalizeProjectIcon(input.icon) : null;
    if (icon !== space.icon) {
      set.icon = icon;
      changes.icon = icon;
    }
  }
  if (input.color !== undefined) {
    const color = assertColor(input.color);
    if (color !== space.color) {
      set.color = color;
      changes.color = color;
    }
  }
  if (!Object.keys(changes).length) return;
  db.transaction((tx) => {
    tx.update(spaces).set(set).where(eq(spaces.id, spaceId)).run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      event: { type: "space.updated", spaceId, name: space.name, changes },
    });
  });
}

/**
 * Delete a Space. Admin-only. Its lists aren't deleted: they leave the Space
 * and go back to being their owners' own lists, still shared with anyone they
 * were shared with directly. Everyone else loses access to them.
 */
export function deleteSpace(
  db: Db,
  userId: string,
  spaceId: string,
  source: AuditOrigin,
): void {
  const { space } = requireAdmin(db, userId, spaceId, "delete the space");
  const listIds = listIdsInSpace(db, spaceId);
  const people = db
    .select({ userId: spaceMembers.userId })
    .from(spaceMembers)
    .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.status, "accepted")))
    .all()
    .map((r) => r.userId);
  db.transaction((tx) => {
    // Cascades the memberships; lists' space_id is set null.
    tx.delete(spaces).where(eq(spaces.id, spaceId)).run();
    const lost = { unassigned: 0, ended: 0 };
    for (const person of people) {
      for (const listId of listIds) {
        const r = revokeListAccess(tx as unknown as Db, person, listId);
        lost.unassigned += r.unassigned;
        lost.ended += r.ended;
      }
    }
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      event: {
        type: "space.deleted",
        spaceId,
        name: space.name,
        lost: accessLost(lost),
        members: people,
      },
    });
  });
}

/**
 * Invite an existing user to a Space, as a member (the default), a
 * commenter or a viewer. Admin-only. They get that role once they accept;
 * an admin can make them an admin after that.
 */
export function inviteSpaceMember(
  db: Db,
  userId: string,
  spaceId: string,
  handle: string,
  source: AuditOrigin,
  role: Exclude<SpaceRole, "admin"> = "member",
): SpaceMemberView {
  const { space } = requireAdmin(db, userId, spaceId, "invite people");
  if (!["member", "commenter", "viewer"].includes(role)) throw new Error(`invalid role: ${role}`);
  const target = findUserByHandle(db, handle);
  if (!target) throw new Error(`no account found for "${handle.trim()}"`);
  const existing = membershipOf(db, target.id, spaceId);
  if (existing) {
    throw new Error(
      existing.status === "accepted"
        ? `${handleFor(target, target.id)} is already in this space`
        : `an invite is already pending for ${handleFor(target, target.id)}`,
    );
  }
  const id = nanoid(12);
  const now = Date.now();
  db.transaction((tx) => {
    tx.insert(spaceMembers)
      .values({ id, spaceId, userId: target.id, status: "pending", role, createdAt: now })
      .run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      event: {
        type: "space.member.invited",
        space: { spaceId, name: space.name },
        membershipId: id,
        member: personAt(target),
        role,
      },
    });
  });
  return {
    userId: target.id,
    username: target.username,
    displayUsername: target.displayUsername,
    name: target.name,
    email: target.email,
    status: "pending",
    role,
    createdAt: now,
  };
}

function spaceName(db: Db, spaceId: string): string {
  return (
    db.select({ name: spaces.name }).from(spaces).where(eq(spaces.id, spaceId)).get()
      ?.name ?? spaceId
  );
}

/** Accept a pending Space invite, gaining access to every list in it. */
export function acceptSpaceInvite(
  db: Db,
  userId: string,
  spaceId: string,
  source: AuditOrigin,
): void {
  const membership = membershipOf(db, userId, spaceId);
  if (membership?.status !== "pending") throw new Error("no pending invite for this space");
  db.transaction((tx) => {
    // Flip only if still pending, so a revoke racing this accept can't be undone.
    const flipped = tx
      .update(spaceMembers)
      .set({ status: "accepted", position: nextTrayPosition(tx as unknown as Db, userId) })
      .where(and(eq(spaceMembers.id, membership.id), eq(spaceMembers.status, "pending")))
      .run();
    if (flipped.changes === 0) throw new Error("no pending invite for this space");
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      event: {
        type: "space.member.joined",
        space: { spaceId, name: spaceName(db, spaceId) },
        membershipId: membership.id,
      },
    });
  });
}

/** Decline a pending Space invite. */
export function declineSpaceInvite(
  db: Db,
  userId: string,
  spaceId: string,
  source: AuditOrigin,
): void {
  const membership = membershipOf(db, userId, spaceId);
  if (membership?.status !== "pending") throw new Error("no pending invite for this space");
  db.transaction((tx) => {
    tx.delete(spaceMembers).where(eq(spaceMembers.id, membership.id)).run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      event: {
        type: "space.member.declined",
        space: { spaceId, name: spaceName(db, spaceId) },
        membershipId: membership.id,
      },
    });
  });
}

/**
 * Remove someone from a Space: an admin removing anyone (or revoking an
 * invite), or anyone leaving. The last admin can't leave. Lists they own stay
 * in the Space; they lose access to everyone else's, with the usual cleanup
 * (revokeListAccess). No-op if they have no membership.
 */
export function removeSpaceMember(
  db: Db,
  userId: string,
  spaceId: string,
  targetUserId: string,
  source: AuditOrigin,
): void {
  const leaving = targetUserId === userId;
  const { space } = leaving
    ? requireMember(db, userId, spaceId)
    : requireAdmin(db, userId, spaceId, "remove people");
  const membership = membershipOf(db, targetUserId, spaceId);
  if (!membership) return;
  const target = db.select().from(users).where(eq(users.id, targetUserId)).get();
  const how: MemberExit = leaving
    ? "left"
    : membership.status === "pending"
      ? "revoked"
      : "removed";
  const listIds = listIdsInSpace(db, spaceId);
  db.transaction((tx) => {
    tx.delete(spaceMembers).where(eq(spaceMembers.id, membership.id)).run();
    // Checked after the write, in the same transaction, so two admins removed
    // at once can't both pass and leave the Space with none. Throwing rolls
    // the removal back.
    if (adminCount(tx as unknown as Db, spaceId) === 0) {
      throw new Error(
        "the last admin can't leave the space: make someone else an admin first, or delete the space",
      );
    }
    const lost = { unassigned: 0, ended: 0 };
    for (const listId of listIds) {
      const r = revokeListAccess(tx as unknown as Db, targetUserId, listId);
      lost.unassigned += r.unassigned;
      lost.ended += r.ended;
    }
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      event: {
        type: "space.member.removed",
        space: { spaceId, name: space.name },
        membershipId: membership.id,
        member: personAt(target ?? { id: targetUserId, username: null }),
        how,
        lost: accessLost(lost),
      },
    });
  });
}

/**
 * Change someone's role in a Space: admin, member, commenter or viewer.
 * Admin-only. A pending invite's role can change too, but not to admin:
 * admins are made from people who've joined. The last admin can't be given
 * another role. Taking edit away takes them off the Space's items and ends
 * their agents there (revokeListAccess), on lists they can't edit another way.
 */
export function setSpaceMemberRole(
  db: Db,
  userId: string,
  spaceId: string,
  targetUserId: string,
  role: SpaceRole,
  source: AuditOrigin,
): void {
  if (!(SPACE_ROLES as readonly string[]).includes(role)) {
    throw new Error(`invalid role: ${role}`);
  }
  const { space } = requireAdmin(db, userId, spaceId, "change roles");
  const membership = membershipOf(db, targetUserId, spaceId);
  if (!membership) throw new Error("they aren't in this space");
  if (membership.status !== "accepted" && role === "admin") {
    throw new Error("only people who've joined the space can be made an admin");
  }
  if (membership.role === role) return;
  const target = db.select().from(users).where(eq(users.id, targetUserId)).get();
  db.transaction((tx) => {
    tx.update(spaceMembers).set({ role }).where(eq(spaceMembers.id, membership.id)).run();
    // As in removeSpaceMember: checked after the write, inside the transaction.
    if (adminCount(tx as unknown as Db, spaceId) === 0) {
      throw new Error("the space needs an admin: make someone else an admin first");
    }
    const lost = { unassigned: 0, ended: 0 };
    for (const projectId of listIdsInSpace(tx as unknown as Db, spaceId)) {
      const l = revokeListAccess(tx as unknown as Db, targetUserId, projectId);
      lost.unassigned += l.unassigned;
      lost.ended += l.ended;
    }
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      event: {
        type: "space.member.role",
        space: { spaceId, name: space.name },
        membershipId: membership.id,
        member: personAt(target ?? { id: targetUserId, username: null }),
        role,
        lost: accessLost(lost),
      },
    });
  });
}

/**
 * Move a list into a Space, into another one, or out of its Space (null).
 * Its owner may do any of these, into a Space they've joined. An admin of the
 * list's current Space may also take it out, back to its owner. Whoever no
 * longer reaches the list afterwards gets the usual cleanup
 * (revokeListAccess). Audited on the list, so its activity shows the move.
 */
export function setProjectSpace(
  db: Db,
  userId: string,
  projectId: string,
  spaceId: string | null,
  source: AuditOrigin,
): void {
  const project = db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), hasProjectAccess(userId)))
    .get();
  if (!project) throw new Error(`list not found: ${projectId}`);
  if (project.spaceId === spaceId) return;
  const isOwner = project.userId === userId;
  const from = project.spaceId
    ? db.select().from(spaces).where(eq(spaces.id, project.spaceId)).get()
    : undefined;
  const fromRole = from && membershipOf(db, userId, from.id);
  const takingOut =
    spaceId === null && fromRole?.status === "accepted" && fromRole.role === "admin";
  if (!isOwner && !takingOut) {
    throw new Error(
      spaceId === null
        ? "only the list owner or a space admin can take a list out of its space"
        : "only the list owner can move a list into a space",
    );
  }
  const joined = spaceId ? requireMember(db, userId, spaceId) : undefined;
  if (joined && joined.membership.role !== "admin" && joined.membership.role !== "member") {
    throw new Error("only the space's admins and members can add lists to it");
  }
  const to = joined?.space;
  // Everyone who reached the list through the Space it's leaving; any who
  // still reach it another way keep it (revokeListAccess checks).
  const losing = from
    ? db
        .select({ userId: spaceMembers.userId })
        .from(spaceMembers)
        .where(and(eq(spaceMembers.spaceId, from.id), eq(spaceMembers.status, "accepted")))
        .all()
        .map((r) => r.userId)
    : [];
  db.transaction((tx) => {
    tx.update(projects).set({ spaceId }).where(eq(projects.id, projectId)).run();
    const lost = { unassigned: 0, ended: 0 };
    for (const person of losing) {
      const r = revokeListAccess(tx as unknown as Db, person, projectId);
      lost.unassigned += r.unassigned;
      lost.ended += r.ended;
    }
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      event: {
        type: "list.space.changed",
        projectId,
        listName: project.name,
        from: from ? { spaceId: from.id, name: from.name } : null,
        to: to ? { spaceId: to.id, name: to.name } : null,
        lost: accessLost(lost),
      },
    });
  });
}

/** The Spaces `userId` has joined, in their own order, with their role and
 * position in each. Memberships from before trays could move have no
 * position until they're placed (placeTrays); they follow, oldest first, as
 * the board showed them then. */
function joinedSpaces(db: Db, userId: string) {
  return db
    .select({ space: spaces, role: spaceMembers.role, position: spaceMembers.position })
    .from(spaceMembers)
    .innerJoin(spaces, eq(spaces.id, spaceMembers.spaceId))
    .where(and(eq(spaceMembers.userId, userId), eq(spaceMembers.status, "accepted")))
    .orderBy(
      sql`${spaceMembers.position} is null`,
      asc(spaceMembers.position),
      asc(spaces.createdAt),
      asc(spaces.id),
    )
    .all();
}

/** The Spaces `userId` has joined, with their role in each, in their order. */
export function listSpaces(db: Db, userId: string): SpaceView[] {
  return joinedSpaces(db, userId).map(({ space, role }) => ({ ...space, role }));
}

/** The board's tray for the viewer's lists in none of their Spaces, in tray
 * order alongside Space ids. Space ids are 12-character nanoids, so it can't
 * clash with one. */
export const PERSONAL_TRAY = "personal";

type TrayPosition = { id: string; position: string | null };

/** `userId`'s trays in board order, each with its position: Personal and
 * their Spaces. Until placed, Personal comes first and Spaces last. */
function trayPositions(db: Db, userId: string): TrayPosition[] {
  const personal =
    db
      .select({ position: users.personalTrayPosition })
      .from(users)
      .where(eq(users.id, userId))
      .get()?.position ?? null;
  const joined = joinedSpaces(db, userId).map(({ space, position }) => ({
    id: space.id,
    position,
  }));
  const at =
    personal === null
      ? 0
      : joined.findIndex((s) => s.position === null || s.position > personal);
  return joined.toSpliced(at === -1 ? joined.length : at, 0, {
    id: PERSONAL_TRAY,
    position: personal,
  });
}

/** The ids of `userId`'s trays in board order: PERSONAL_TRAY and the Spaces
 * they've joined. */
export function listTrays(db: Db, userId: string): string[] {
  return trayPositions(db, userId).map((t) => t.id);
}

/**
 * Move a tray on the caller's board, among their Spaces: a Space, or
 * PERSONAL_TRAY for their lists in none. ref is start | end | after:<id> |
 * before:<id>, anchored on either. Only their order changes, never another
 * member's. Any tray they haven't placed yet first gets a position where it
 * shows now, so the ref can anchor on any of them.
 */
export function reorderSpace(
  db: Db,
  userId: string,
  trayId: string,
  refRaw: string,
  source: AuditOrigin,
): void {
  const name =
    trayId === PERSONAL_TRAY ? "Personal" : requireMember(db, userId, trayId).space.name;
  const ref = parseProjectRef(refRaw);
  db.transaction((tx) => {
    const others = placeTrays(tx as unknown as Db, userId).filter((t) => t.id !== trayId);
    setTrayPosition(tx as unknown as Db, userId, trayId, resolvePosition(others, ref));
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      event: { type: "space.reordered", spaceId: trayId, name },
    });
  });
}

/** Give each of `userId`'s unplaced trays a position where it shows now
 * (Personal first, Spaces last), and return them all, sorted. */
// audit-exempt: runs inside its callers' audited transactions.
function placeTrays(db: Db, userId: string): { id: string; position: string }[] {
  const trays = trayPositions(db, userId);
  const placed = trays.filter((t): t is { id: string; position: string } => t.position !== null);
  for (const { id, position } of trays) {
    if (position !== null) continue;
    const first = id === PERSONAL_TRAY;
    const next = resolvePosition(placed, first ? "first" : "last");
    setTrayPosition(db, userId, id, next);
    if (first) placed.unshift({ id, position: next });
    else placed.push({ id, position: next });
  }
  return placed;
}

/** The position for a Space `userId` creates or joins: after all their
 * trays, so it shows last, as a new list does. Call it before the membership
 * is accepted, so it isn't counted among them. */
// audit-exempt: runs inside createSpace's and acceptSpaceInvite's audited transactions.
function nextTrayPosition(db: Db, userId: string): string {
  return resolvePosition(placeTrays(db, userId), "last");
}

// audit-exempt: runs inside its callers' audited transactions.
function setTrayPosition(db: Db, userId: string, trayId: string, position: string): void {
  if (trayId === PERSONAL_TRAY) {
    db.update(users).set({ personalTrayPosition: position }).where(eq(users.id, userId)).run();
  } else {
    db.update(spaceMembers)
      .set({ position })
      .where(and(eq(spaceMembers.spaceId, trayId), eq(spaceMembers.userId, userId)))
      .run();
  }
}

/** Everyone in a Space and everyone invited, in the order they were added.
 * Visible to its members; empty for anyone else. */
export function listSpaceMembers(
  db: Db,
  userId: string,
  spaceId: string,
): SpaceMemberView[] {
  if (membershipOf(db, userId, spaceId)?.status !== "accepted") return [];
  return db
    .select({ membership: spaceMembers, user: users })
    .from(spaceMembers)
    .leftJoin(users, eq(users.id, spaceMembers.userId))
    .where(eq(spaceMembers.spaceId, spaceId))
    .orderBy(asc(spaceMembers.createdAt), asc(spaceMembers.id))
    .all()
    .map(({ membership, user }) => ({
      userId: membership.userId,
      username: user?.username ?? null,
      displayUsername: user?.displayUsername ?? null,
      name: user?.name ?? null,
      email: user?.email ?? null,
      status: membership.status,
      role: membership.role,
      createdAt: membership.createdAt,
    }));
}

/**
 * People an admin already shares a list or a Space with who aren't in this
 * Space and haven't been invited to it, for one-tap invites. Empty for anyone
 * but an admin, since only admins invite.
 */
export function listSuggestedSpaceMembers(
  db: Db,
  userId: string,
  spaceId: string,
): CollaboratorView[] {
  const membership = membershipOf(db, userId, spaceId);
  if (membership?.status !== "accepted" || membership.role !== "admin") return [];
  return suggestCollaborators(
    db,
    userId,
    sql`(select ${spaceMembers.userId} from ${spaceMembers} where ${spaceMembers.spaceId} = ${spaceId})`,
  );
}

/** The caller's own pending Space invites. */
export function listPendingSpaceInvites(
  db: Db,
  userId: string,
): PendingSpaceInviteView[] {
  return db
    .select({
      spaceId: spaces.id,
      spaceName: spaces.name,
      createdAt: spaceMembers.createdAt,
    })
    .from(spaceMembers)
    .innerJoin(spaces, eq(spaces.id, spaceMembers.spaceId))
    .where(and(eq(spaceMembers.userId, userId), eq(spaceMembers.status, "pending")))
    .orderBy(asc(spaceMembers.createdAt))
    .all();
}
