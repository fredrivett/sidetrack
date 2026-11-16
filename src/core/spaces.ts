import { and, asc, count, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { normalizeProjectIcon } from "../lib/projectIcon";
import { hasProjectAccess } from "./access";
import { users } from "./auth-schema";
import { type AuditOrigin, recordAudit } from "./audit";
import type { Db } from "./db";
import {
  accessLossDetail,
  type CollaboratorView,
  findUserByHandle,
  handleFor,
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
        createdAt: now,
      })
      .run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      action: "create",
      entityType: "space",
      entityId: id,
      detail: `created space "${name}"${color ? ` (${color})` : ""}`,
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
  const changes: string[] = [];
  if (input.name !== undefined) {
    const name = assertName(input.name);
    if (name !== space.name) {
      set.name = name;
      changes.push(`renamed to "${name}"`);
    }
  }
  if (input.icon !== undefined) {
    const icon = input.icon ? normalizeProjectIcon(input.icon) : null;
    if (icon !== space.icon) {
      set.icon = icon;
      changes.push(icon ? `icon set to ${icon}` : "icon cleared");
    }
  }
  if (input.color !== undefined) {
    const color = assertColor(input.color);
    if (color !== space.color) {
      set.color = color;
      changes.push(color ? `colour set to ${color}` : "colour cleared");
    }
  }
  if (!changes.length) return;
  db.transaction((tx) => {
    tx.update(spaces).set(set).where(eq(spaces.id, spaceId)).run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      action: "update",
      entityType: "space",
      entityId: spaceId,
      detail: `space "${space.name}": ${changes.join(", ")}`,
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
      action: "delete",
      entityType: "space",
      entityId: spaceId,
      detail: [`deleted space "${space.name}"`, ...accessLossDetail(lost)].join(", "),
    });
  });
}

/**
 * Invite an existing user to a Space. Admin-only. They join as a member once
 * they accept; an admin can make them an admin after that.
 */
export function inviteSpaceMember(
  db: Db,
  userId: string,
  spaceId: string,
  handle: string,
  source: AuditOrigin,
): SpaceMemberView {
  const { space } = requireAdmin(db, userId, spaceId, "invite people");
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
      .values({ id, spaceId, userId: target.id, status: "pending", role: "member", createdAt: now })
      .run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      action: "create",
      entityType: "space_member",
      entityId: id,
      detail: `invited ${handleFor(target, target.id)} to space "${space.name}"`,
    });
  });
  return {
    userId: target.id,
    username: target.username,
    displayUsername: target.displayUsername,
    name: target.name,
    email: target.email,
    status: "pending",
    role: "member",
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
      .set({ status: "accepted" })
      .where(and(eq(spaceMembers.id, membership.id), eq(spaceMembers.status, "pending")))
      .run();
    if (flipped.changes === 0) throw new Error("no pending invite for this space");
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      action: "update",
      entityType: "space_member",
      entityId: membership.id,
      detail: `accepted invite to space "${spaceName(db, spaceId)}"`,
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
      action: "delete",
      entityType: "space_member",
      entityId: membership.id,
      detail: `declined invite to space "${spaceName(db, spaceId)}"`,
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
  const who = handleFor(target, targetUserId);
  const detail = leaving
    ? `left space "${space.name}"`
    : membership.status === "pending"
      ? `revoked space invite for ${who} to "${space.name}"`
      : `removed ${who} from space "${space.name}"`;
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
      action: "delete",
      entityType: "space_member",
      entityId: membership.id,
      detail: [detail, ...accessLossDetail(lost)].join(", "),
    });
  });
}

/**
 * Make someone in a Space an admin, or a member again. Admin-only, for people
 * who've accepted. The last admin can't be made a member.
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
  if (membership?.status !== "accepted") {
    throw new Error("only people who've joined the space can have their role changed");
  }
  if (membership.role === role) return;
  const target = db.select().from(users).where(eq(users.id, targetUserId)).get();
  db.transaction((tx) => {
    tx.update(spaceMembers).set({ role }).where(eq(spaceMembers.id, membership.id)).run();
    // As in removeSpaceMember: checked after the write, inside the transaction.
    if (adminCount(tx as unknown as Db, spaceId) === 0) {
      throw new Error("the space needs an admin: make someone else an admin first");
    }
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      action: "update",
      entityType: "space_member",
      entityId: membership.id,
      detail: `made ${handleFor(target, targetUserId)} ${role === "admin" ? "an admin" : "a member"} of space "${space.name}"`,
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
  const to = spaceId ? requireMember(db, userId, spaceId).space : undefined;
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
  const detail = !from
    ? `moved "${project.name}" into space "${to?.name}"`
    : !to
      ? `took "${project.name}" out of space "${from.name}"`
      : `moved "${project.name}" from space "${from.name}" to "${to.name}"`;
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
      action: "update",
      entityType: "project",
      entityId: projectId,
      projectId,
      detail: [detail, ...accessLossDetail(lost)].join(", "),
    });
  });
}

/** The Spaces `userId` has joined, with their role in each, oldest first. */
export function listSpaces(db: Db, userId: string): SpaceView[] {
  return db
    .select({ space: spaces, role: spaceMembers.role })
    .from(spaceMembers)
    .innerJoin(spaces, eq(spaces.id, spaceMembers.spaceId))
    .where(and(eq(spaceMembers.userId, userId), eq(spaceMembers.status, "accepted")))
    .orderBy(asc(spaces.createdAt), asc(spaces.id))
    .all()
    .map(({ space, role }) => ({ ...space, role }));
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
