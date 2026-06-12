import { and, asc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { users } from "./auth-schema";
import { recordAudit } from "./audit";
import type { Db } from "./db";
import { getProject, nextProjectPosition } from "./projects";
import {
  type AuditSource,
  type MembershipStatus,
  projectMembers,
  projectPositions,
  projects,
} from "./schema";

/** A project member (or pending invite) with the target user's display info. */
export interface MemberView {
  userId: string;
  username: string | null;
  displayUsername: string | null;
  name: string | null;
  email: string | null;
  status: MembershipStatus;
  createdAt: number;
}

/** A pending invite from the invitee's perspective: which project, whose. */
export interface PendingInviteView {
  projectId: string;
  projectName: string;
  ownerName: string | null;
  createdAt: number;
}

/**
 * Resolve an invite target to an existing user. Accepts an email (anything with
 * an `@` that isn't a leading handle marker) or a username (`alice` or
 * `@alice`). Usernames are stored normalized (lowercased); emails are matched
 * case-insensitively. Returns undefined when no account matches — invites
 * require the target to have signed up already.
 */
function findUserByHandle(db: Db, raw: string) {
  const input = raw.trim();
  if (!input) return undefined;
  if (input.startsWith("@")) {
    const handle = input.slice(1).toLowerCase();
    return db.select().from(users).where(eq(users.username, handle)).get();
  }
  if (input.includes("@")) {
    return db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${input.toLowerCase()}`)
      .get();
  }
  return db
    .select()
    .from(users)
    .where(eq(users.username, input.toLowerCase()))
    .get();
}

function getUserById(db: Db, id: string) {
  return db.select().from(users).where(eq(users.id, id)).get();
}

/** A user's display name (falls back to their email, then null). Used by the
 * MCP invite tool to name the inviter in the notification email. */
export function getUserName(db: Db, id: string): string | null {
  const user = getUserById(db, id);
  return user?.name ?? user?.email ?? null;
}

/** Display handle for an audit detail: `@username`, falling back to the id. */
function handleFor(user: { username: string | null } | undefined, id: string) {
  return user?.username ? `@${user.username}` : id;
}

/**
 * Invite an existing user to collaborate on a project. Owner-only. The invite
 * lands as a `pending` membership the target must accept before they gain
 * access. Throws if the caller isn't the owner, the target has no account, the
 * target is already the owner, or a membership/invite already exists.
 */
export function inviteMember(
  db: Db,
  userId: string,
  projectId: string,
  handle: string,
  source: AuditSource,
): MemberView {
  const project = getProject(db, userId, projectId);
  if (!project) throw new Error(`project not found: ${projectId}`);
  if (project.userId !== userId) {
    throw new Error("only the project owner can invite members");
  }

  const target = findUserByHandle(db, handle);
  if (!target) throw new Error(`no account found for "${handle.trim()}"`);
  if (target.id === project.userId) {
    throw new Error("the owner already has access to this project");
  }

  const existing = db
    .select()
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.userId, target.id),
      ),
    )
    .get();
  if (existing) {
    throw new Error(
      existing.status === "accepted"
        ? `${handleFor(target, target.id)} is already a member`
        : `an invite is already pending for ${handleFor(target, target.id)}`,
    );
  }

  const id = nanoid(12);
  db.transaction((tx) => {
    tx.insert(projectMembers)
      .values({ id, projectId, userId: target.id, status: "pending" })
      .run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      action: "create",
      entityType: "member",
      entityId: id,
      projectId,
      detail: `invited ${handleFor(target, target.id)} to "${project.name}"`,
    });
  });

  return {
    userId: target.id,
    username: target.username,
    displayUsername: target.displayUsername,
    name: target.name,
    email: target.email,
    status: "pending",
    createdAt: Date.now(),
  };
}

/** Look up the caller's own membership row in a project, whatever its status. */
function ownMembership(db: Db, userId: string, projectId: string) {
  return db
    .select()
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.userId, userId),
      ),
    )
    .get();
}

/** Read a project by id without an access filter (the invitee can't see it via
 * getProject until they accept). Used only to resolve a name for the log. */
function projectName(db: Db, projectId: string): string {
  const row = db
    .select({ name: projects.name })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  return row?.name ?? projectId;
}

/**
 * Accept a pending invite, flipping it to `accepted` and granting access.
 * Throws if the caller has no pending invite for the project (already accepted
 * is a no-op error, since re-accepting is meaningless).
 */
export function acceptInvite(
  db: Db,
  userId: string,
  projectId: string,
  source: AuditSource,
): void {
  const membership = ownMembership(db, userId, projectId);
  if (!membership || membership.status !== "pending") {
    throw new Error("no pending invite for this project");
  }
  // Give the new member their own ordering slot, appended to the end of their
  // board, so the shared project sorts sensibly among their own projects.
  const position = nextProjectPosition(db, userId);
  db.transaction((tx) => {
    tx.update(projectMembers)
      .set({ status: "accepted" })
      .where(eq(projectMembers.id, membership.id))
      .run();
    tx.insert(projectPositions)
      .values({ userId, projectId, position })
      .run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      action: "update",
      entityType: "member",
      entityId: membership.id,
      projectId,
      detail: `accepted invite to "${projectName(db, projectId)}"`,
    });
  });
}

/** Decline a pending invite, deleting the row. No-op error if none pending. */
export function declineInvite(
  db: Db,
  userId: string,
  projectId: string,
  source: AuditSource,
): void {
  const membership = ownMembership(db, userId, projectId);
  if (!membership || membership.status !== "pending") {
    throw new Error("no pending invite for this project");
  }
  db.transaction((tx) => {
    tx.delete(projectMembers)
      .where(eq(projectMembers.id, membership.id))
      .run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      action: "delete",
      entityType: "member",
      entityId: membership.id,
      projectId,
      detail: `declined invite to "${projectName(db, projectId)}"`,
    });
  });
}

/**
 * Remove a membership. The owner may remove anyone (revoking a pending invite
 * or removing an accepted member); a member may remove only themselves
 * (leaving). No-op if there's no matching membership row.
 */
export function removeMember(
  db: Db,
  userId: string,
  projectId: string,
  targetUserId: string,
  source: AuditSource,
): void {
  const leaving = targetUserId === userId;
  if (!leaving) {
    const project = getProject(db, userId, projectId);
    if (!project) throw new Error(`project not found: ${projectId}`);
    if (project.userId !== userId) {
      throw new Error("only the project owner can remove members");
    }
  }

  const membership = db
    .select()
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.userId, targetUserId),
      ),
    )
    .get();
  if (!membership) return;

  const target = getUserById(db, targetUserId);
  const detail = leaving
    ? `left "${projectName(db, projectId)}"`
    : membership.status === "pending"
      ? `revoked invite for ${handleFor(target, targetUserId)}`
      : `removed ${handleFor(target, targetUserId)}`;

  db.transaction((tx) => {
    tx.delete(projectMembers)
      .where(eq(projectMembers.id, membership.id))
      .run();
    // Drop their ordering slot too (no user FK to cascade it). A pending
    // member never had one, so this is a harmless no-op in that case.
    tx.delete(projectPositions)
      .where(
        and(
          eq(projectPositions.userId, targetUserId),
          eq(projectPositions.projectId, projectId),
        ),
      )
      .run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      action: "delete",
      entityType: "member",
      entityId: membership.id,
      projectId,
      detail,
    });
  });
}

/**
 * The members and pending invites on a project (excludes the owner — that's
 * projects.userId, surfaced separately). Visible to anyone with access.
 */
export function listMembers(
  db: Db,
  userId: string,
  projectId: string,
): MemberView[] {
  if (!getProject(db, userId, projectId)) return [];
  return db
    .select({ membership: projectMembers, user: users })
    .from(projectMembers)
    .leftJoin(users, eq(users.id, projectMembers.userId))
    .where(eq(projectMembers.projectId, projectId))
    .orderBy(asc(projectMembers.createdAt))
    .all()
    .map((r) => ({
      userId: r.membership.userId,
      username: r.user?.username ?? null,
      displayUsername: r.user?.displayUsername ?? null,
      name: r.user?.name ?? null,
      email: r.user?.email ?? null,
      status: r.membership.status,
      createdAt: r.membership.createdAt,
    }));
}

/** The caller's own pending invites, with the project name and owner. */
export function listPendingInvites(
  db: Db,
  userId: string,
): PendingInviteView[] {
  return db
    .select({
      projectId: projects.id,
      projectName: projects.name,
      ownerName: users.name,
      createdAt: projectMembers.createdAt,
    })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .leftJoin(users, eq(users.id, projects.userId))
    .where(
      and(
        eq(projectMembers.userId, userId),
        eq(projectMembers.status, "pending"),
      ),
    )
    .orderBy(asc(projectMembers.createdAt))
    .all();
}
