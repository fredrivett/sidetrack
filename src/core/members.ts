import { and, asc, eq, inArray, isNull, ne, type SQL, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { hasProjectAccess, listAccess } from "./access";
import { users } from "./auth-schema";
import { type AuditOrigin, recordAudit } from "./audit";
import type { Db } from "./db";
import { type AccessLost, accessLost, type MemberExit, type PersonAt } from "./events";
import { getProject, nextProjectPosition } from "./projects";
import {
  agentSessions,
  items,
  LIST_ROLES,
  type ListRole,
  type MembershipStatus,
  ONLY_WITHIN,
  type OnlyWithin,
  projectMembers,
  projectPositions,
  projects,
  spaceMembers,
} from "./schema";

/** A project member (or pending invite) with the target user's display info. */
export interface MemberView {
  userId: string;
  username: string | null;
  displayUsername: string | null;
  name: string | null;
  email: string | null;
  status: MembershipStatus;
  /** What they can do on the list. */
  role: ListRole;
  /** Set when they see only the items assigned to this user ("only my tasks"). */
  onlyAssignedTo: string | null;
  /** With onlyAssignedTo, only their today or week; null is every day. */
  onlyWithin: OnlyWithin | null;
  /** When onlyAssignedTo isn't the owner but someone sharing their own day: their name. */
  sharerName?: string;
  createdAt: number;
}

/**
 * A user who can be assigned items on a project: the owner or an accepted
 * member. Carries the display fields the assignee picker needs (avatar + name).
 */
export interface AssigneeView {
  userId: string;
  username: string | null;
  displayUsername: string | null;
  name: string | null;
  email: string | null;
  image: string | null;
  isOwner: boolean;
  /** Whether they can change the list, and so hold its work. Viewers and
   * commenters are on the list, to mention and to see, but not to assign. */
  canEdit: boolean;
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
export function findUserByHandle(db: Db, raw: string) {
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

export function getUserById(db: Db, id: string) {
  return db.select().from(users).where(eq(users.id, id)).get();
}

/** A user's display name (falls back to their email, then null). Used by the
 * MCP invite tool to name the inviter in the notification email. */
export function getUserName(db: Db, id: string): string | null {
  const user = getUserById(db, id);
  return user?.name ?? user?.email ?? null;
}

/** Display handle for a message: `@username`, falling back to the id. */
export function handleFor(user: { username: string | null } | undefined, id: string) {
  return user?.username ? `@${user.username}` : id;
}

/**
 * Invite an existing user to collaborate on a project. Owner-only, except
 * that anyone who can edit it can share their own day there. The invite
 * lands as a `pending` membership the target must accept before they gain
 * access. Throws if the caller isn't the owner, the target has no account, the
 * target is already the owner, or a membership/invite already exists.
 */
export function inviteMember(
  db: Db,
  userId: string,
  projectId: string,
  handle: string,
  source: AuditOrigin,
  role: ListRole = "editor",
  opts: {
    /** Shared by each place one invite (invitePeople) covers. */
    inviteId?: string;
    /** They'll see only the items assigned to the inviter ("only my tasks"). */
    onlyMine?: boolean;
    /** With onlyMine, only those in the inviter's today or week. */
    within?: OnlyWithin | null;
    /** With within, whether they also see your day note's words and mood (its tags). */
    shareNote?: boolean;
    shareMood?: boolean;
  } = {},
): MemberView {
  assertListRole(role);
  const { inviteId, onlyMine } = opts;
  const within = assertWithin(onlyMine, opts.within);
  if (onlyMine && role === "editor") {
    throw new Error("only viewers and commenters can be shown just your items");
  }
  const project = getProject(db, userId, projectId);
  if (!project) throw new Error(`list not found: ${projectId}`);
  // Anyone who can edit the list can share their own day on it: only their
  // items show (hasItemAccess), and the list's people are told who's coming.
  const sharingDay = onlyMine && within !== null && listAccess(db, userId, projectId) === "edit";
  if (project.userId !== userId && !sharingDay) {
    throw new Error("only the list owner can invite members");
  }

  const target = findUserByHandle(db, handle);
  if (!target) throw new Error(`no account found for "${handle.trim()}"`);
  if (target.id === project.userId) {
    throw new Error("the owner already has access to this list");
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
      .values({
        id,
        projectId,
        userId: target.id,
        status: "pending",
        role,
        onlyAssignedTo: onlyMine ? userId : null,
        onlyWithin: within,
        shareNote: !!within && !!opts.shareNote,
        shareMood: !!within && !!opts.shareMood,
      })
      .run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      event: {
        type: "member.invited",
        projectId,
        listName: project.name,
        membershipId: id,
        member: personAt(target),
        role,
        ...(inviteId ? { inviteId } : {}),
        ...(onlyMine ? { onlyAssignedTo: personAt(getUserById(tx as unknown as Db, userId) ?? { id: userId, username: null }) } : {}),
        ...(within ? { onlyWithin: within } : {}),
        ...(within && opts.shareNote ? { shareNote: true as const } : {}),
        ...(within && opts.shareMood ? { shareMood: true as const } : {}),
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
    onlyAssignedTo: onlyMine ? userId : null,
    onlyWithin: within,
    createdAt: Date.now(),
  };
}

/** The window to store: only with a limit to someone's items, and a known one. */
export function assertWithin(limited: boolean | undefined, within: OnlyWithin | null | undefined): OnlyWithin | null {
  if (!within) return null;
  if (!(ONLY_WITHIN as readonly string[]).includes(within)) throw new Error(`invalid window: ${within}`);
  if (!limited) throw new Error("only someone shown just your items can be shown just your today or week");
  return within;
}

function assertListRole(role: string): asserts role is ListRole {
  if (!(LIST_ROLES as readonly string[]).includes(role)) throw new Error(`invalid role: ${role}`);
}

/**
 * Change what a member, or someone invited, can do on the list: edit,
 * comment or only view, and with `onlyMine`, whether they see only the
 * caller's items, and with `within`, only those in the owner's today or week
 * (each left as it is when undefined). Owner-only, but for what of their
 * own day someone shares. Taking edit
 * away takes them off the list's items and ends their agents there
 * (revokeListAccess), unless the list's Space still lets them edit.
 */
export function setMemberRole(
  db: Db,
  userId: string,
  projectId: string,
  targetUserId: string,
  role: ListRole,
  source: AuditOrigin,
  onlyMine?: boolean,
  within?: OnlyWithin | null,
  /** With a day share, whether they also see your day note's words, or mood; left as they are when undefined. */
  share?: { note?: boolean; mood?: boolean },
): void {
  assertListRole(role);
  if (onlyMine && role === "editor") {
    throw new Error("only viewers and commenters can be shown just your items");
  }
  const membership = ownMembership(db, targetUserId, projectId);
  // The owner, or whoever they see only the items of: someone sharing their
  // own day, who can change what of it they see (not their role, nor make it
  // all their items for good), even once they're off the list themselves.
  const sharer = membership?.onlyAssignedTo === userId;
  const project = sharer ? db.select().from(projects).where(eq(projects.id, projectId)).get() : getProject(db, userId, projectId);
  if (!project) throw new Error(`list not found: ${projectId}`);
  const owner = project.userId === userId;
  if (!owner && !(sharer && role === membership.role && onlyMine !== false && within !== null)) {
    throw new Error("only the list owner can change roles");
  }
  if (!membership) throw new Error("they aren't on this list");
  // An editor sees the whole list: an edit (a sort, a move) reaches items
  // they couldn't otherwise see.
  const limitedTo =
    role === "editor"
      ? null
      : onlyMine === undefined
        ? membership.onlyAssignedTo
        : onlyMine
          ? userId
          : null;
  // A window is someone's day: one now limited to another person's items isn't theirs.
  const window = within === undefined ? (limitedTo && limitedTo === membership.onlyAssignedTo ? membership.onlyWithin : null) : assertWithin(!!limitedTo, within);
  // Their note and mood go with the day share they were chosen for: a share
  // no longer of that person's day, or of no day, drops them, and setting a
  // window again doesn't bring them back.
  const keepsNote = window !== null && limitedTo === membership.onlyAssignedTo;
  if ((share?.note || share?.mood) && !keepsNote) throw new Error("only your day can be shared with your note or mood");
  const shareNote = keepsNote && (share?.note ?? membership.shareNote);
  const shareMood = keepsNote && (share?.mood ?? membership.shareMood);
  const shareChanged = shareNote !== membership.shareNote || shareMood !== membership.shareMood;
  if (membership.role === role && membership.onlyAssignedTo === limitedTo && membership.onlyWithin === window && !shareChanged) return;
  const target = getUserById(db, targetUserId);
  db.transaction((tx) => {
    tx.update(projectMembers)
      .set({ role, onlyAssignedTo: limitedTo, onlyWithin: window, shareNote, shareMood })
      .where(eq(projectMembers.id, membership.id))
      .run();
    const lost = revokeListAccess(tx as unknown as Db, targetUserId, projectId);
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      event: {
        type: "member.role",
        projectId,
        listName: project.name,
        membershipId: membership.id,
        member: personAt(target ?? { id: targetUserId, username: null }),
        role,
        lost: accessLost(lost),
        ...(limitedTo ? { onlyAssignedTo: personAt(getUserById(tx as unknown as Db, limitedTo) ?? { id: limitedTo, username: null }) } : {}),
        ...(window ? { onlyWithin: window } : {}),
        ...(shareChanged ? { shareNote, shareMood } : {}),
        ...(membership.onlyAssignedTo && !limitedTo ? { seesAll: true as const } : {}),
      },
    });
  });
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
  source: AuditOrigin,
): void {
  const membership = ownMembership(db, userId, projectId);
  if (!membership || membership.status !== "pending") {
    throw new Error("no pending invite for this list");
  }
  // Give the new member their own ordering slot, appended to the end of their
  // board, so the shared project sorts sensibly among their own projects.
  const position = nextProjectPosition(db, userId);
  db.transaction((tx) => {
    // Re-assert pending status inside the transaction and only proceed if a
    // row actually flips. The pre-check above is racy on its own: if the invite
    // were revoked between it and here, an unconditional update would no-op
    // while we still inserted an orphan project_positions row — which then
    // breaks a later re-accept with a PK conflict. The conditional update +
    // changes check makes accept atomic with the status it observed.
    const flipped = tx
      .update(projectMembers)
      .set({ status: "accepted" })
      .where(
        and(
          eq(projectMembers.id, membership.id),
          eq(projectMembers.status, "pending"),
        ),
      )
      .run();
    if (flipped.changes === 0) {
      throw new Error("no pending invite for this list");
    }
    // They may already have a slot, from a Space the list is in.
    tx.insert(projectPositions)
      .values({ userId, projectId, position })
      .onConflictDoNothing()
      .run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      event: {
        type: "member.joined",
        projectId,
        listName: projectName(db, projectId),
        membershipId: membership.id,
        role: membership.role,
        ...(membership.onlyAssignedTo
          ? { onlyAssignedTo: personAt(getUserById(tx as unknown as Db, membership.onlyAssignedTo) ?? { id: membership.onlyAssignedTo, username: null }) }
          : {}),
        ...(membership.onlyWithin ? { onlyWithin: membership.onlyWithin } : {}),
      },
    });
  });
}

/** Decline a pending invite, deleting the row. No-op error if none pending. */
export function declineInvite(
  db: Db,
  userId: string,
  projectId: string,
  source: AuditOrigin,
): void {
  const membership = ownMembership(db, userId, projectId);
  if (!membership || membership.status !== "pending") {
    throw new Error("no pending invite for this list");
  }
  db.transaction((tx) => {
    tx.delete(projectMembers)
      .where(eq(projectMembers.id, membership.id))
      .run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      event: {
        type: "member.declined",
        projectId,
        listName: projectName(db, projectId),
        membershipId: membership.id,
      },
    });
  });
}

/**
 * Remove a membership. The owner may remove anyone (revoking a pending invite
 * or removing an accepted member), and someone sharing their day whoever
 * they share it with; a member may remove only themselves (leaving). No-op
 * if there's no matching membership row.
 */
export function removeMember(
  db: Db,
  userId: string,
  projectId: string,
  targetUserId: string,
  source: AuditOrigin,
): void {
  const leaving = targetUserId === userId;
  // As well as the owner: whoever they see only the items of (setMemberRole).
  const sharer = ownMembership(db, targetUserId, projectId)?.onlyAssignedTo === userId;
  if (!leaving && !sharer) {
    const project = getProject(db, userId, projectId);
    if (!project) throw new Error(`list not found: ${projectId}`);
    if (project.userId !== userId) {
      throw new Error("only the list owner can remove members");
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
  const how: MemberExit = leaving
    ? "left"
    : membership.status === "pending"
      ? "revoked"
      : "removed";

  db.transaction((tx) => {
    tx.delete(projectMembers)
      .where(eq(projectMembers.id, membership.id))
      .run();
    const lost = revokeListAccess(tx as unknown as Db, targetUserId, projectId);
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      event: {
        type: "member.removed",
        projectId,
        listName: projectName(db, projectId),
        membershipId: membership.id,
        member: personAt(target ?? { id: targetUserId, username: null }),
        how,
        lost: accessLost(lost),
      },
    });
  });
}

/**
 * Clean up after `userId` loses access to a project, or the right to change
 * it, if they have: take them off its items (other assignees of a joint item
 * stay) and end their agents' open sessions on it, since only those who can
 * change a list hold its work; and, once they can't open it at all, drop
 * their ordering slot; and end any day share of theirs there. Leaving work assigned or "working" to someone who
 * can't action it would be a lie. Does nothing they still have another way
 * (owner, direct member, or the list's Space), so callers run it after every
 * change that could end access or lower a role. Like the slot cleanup, this
 * is a consequence of the caller's audited event, not its own: the caller's
 * audit row reports the counts.
 */
// audit-exempt: runs inside the caller's audited transaction.
export function revokeListAccess(
  db: Db,
  userId: string,
  projectId: string,
): AccessLost {
  const access = listAccess(db, userId, projectId);
  if (access === "edit") return { unassigned: 0, ended: 0 };
  // Their day, shared on a list they can no longer edit, isn't theirs to
  // share there any more: whoever they shared it with leaves the list, which
  // its owner never chose them for.
  const sharedWith = db
    .select({ id: projectMembers.id, userId: projectMembers.userId })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.onlyAssignedTo, userId)))
    .all();
  if (sharedWith.length) {
    db.delete(projectMembers).where(inArray(projectMembers.id, sharedWith.map((m) => m.id))).run();
    // Their own cleanup, as when removed: a slot only if they can't open it now.
    for (const m of sharedWith) revokeListAccess(db, m.userId, projectId);
  }
  const shares = sharedWith.length ? { shares: sharedWith.length } : {};
  const held = db
    .select({ id: items.id, assigneeIds: items.assigneeIds })
    .from(items)
    .where(
      and(
        eq(items.projectId, projectId),
        sql`exists (select 1 from json_each(${items.assigneeIds}) where value = ${userId})`,
      ),
    )
    .all();
  for (const it of held) {
    db.update(items)
      .set({ assigneeIds: it.assigneeIds.filter((a) => a !== userId) })
      .where(eq(items.id, it.id))
      .run();
  }
  const ended = db
    .update(agentSessions)
    .set({ finishedAt: Date.now() })
    .where(
      and(
        eq(agentSessions.userId, userId),
        isNull(agentSessions.finishedAt),
        inArray(
          agentSessions.itemId,
          db.select({ id: items.id }).from(items).where(eq(items.projectId, projectId)),
        ),
      ),
    )
    .run().changes;
  // Still on their board while they can open it.
  if (access !== null) return { unassigned: held.length, ended, ...shares };
  // No user FK to cascade the slot. Someone who never had one (a pending
  // invitee) makes this a harmless no-op.
  db.delete(projectPositions)
    .where(
      and(
        eq(projectPositions.userId, userId),
        eq(projectPositions.projectId, projectId),
      ),
    )
    .run();
  return { unassigned: held.length, ended, ...shares };
}

/** A user as an event names them: `@username`, falling back to the id. */
export function personAt(user: { id: string; username: string | null }): PersonAt {
  return { userId: user.id, name: handleFor(user, user.id) };
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
  const project = getProject(db, userId, projectId);
  if (!project) return [];
  const sharerName = (id: string | null) => {
    if (!id || id === project.userId) return {};
    const u = getUserById(db, id);
    return { sharerName: u?.name || (u?.username ? `@${u.username}` : "someone") };
  };
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
      role: r.membership.role,
      onlyAssignedTo: r.membership.onlyAssignedTo,
      onlyWithin: r.membership.onlyWithin,
      ...sharerName(r.membership.onlyAssignedTo),
      createdAt: r.membership.createdAt,
    }));
}

/** Someone the caller already collaborates with, suggested for a quick invite. */
export type CollaboratorView = Omit<MemberView, "status" | "role" | "onlyAssignedTo" | "onlyWithin" | "sharerName" | "createdAt">;

/**
 * People the owner already shares another list or a Space with (in either
 * direction, as owner or accepted member) who aren't on this project yet — no
 * member row, pending or accepted, and no access through its Space. Owner-only, since only the owner can invite; empty for
 * anyone else. Pending invites elsewhere don't count: until someone accepts,
 * they aren't a collaborator.
 */
export function listSuggestedCollaborators(
  db: Db,
  userId: string,
  projectId: string,
): CollaboratorView[] {
  const project = getProject(db, userId, projectId);
  if (!project || project.userId !== userId) return [];

  // Already on this list: a member row (pending or accepted), or access
  // through the list's Space.
  const onThisProject = sql`(
    select ${projectMembers.userId} from ${projectMembers}
    where ${projectMembers.projectId} = ${projectId}
    union
    select ${spaceMembers.userId} from ${spaceMembers}
    where ${spaceMembers.status} = 'accepted' and ${spaceMembers.spaceId} = ${project.spaceId ?? ""}
  )`;

  return suggestCollaborators(db, userId, onThisProject);
}

/** Everyone `userId` shares a list or a Space with (see suggestCollaborators). */
export function listCollaborators(db: Db, userId: string): CollaboratorView[] {
  return suggestCollaborators(db, userId, sql`(select null where 0)`);
}

/**
 * Everyone `userId` shares a list or a Space with, however (as owner, accepted
 * member, or through a Space), except themselves and the ids in `exclude`, a
 * subquery. Pending invites don't count: until someone accepts, they aren't a
 * collaborator. Feeds the Share dialog's and a Space's invite suggestions.
 */
export function suggestCollaborators(
  db: Db,
  userId: string,
  exclude: SQL,
): CollaboratorView[] {
  // Every list the caller can see, however they got access.
  const shared = sql`(select ${projects.id} from ${projects} where ${hasProjectAccess(userId)})`;
  // The caller's Spaces: those of the lists above, plus any they're in
  // (a Space can have no lists yet).
  const mySpaces = sql`(
    select ${projects.spaceId} from ${projects}
    where ${projects.id} in ${shared} and ${projects.spaceId} is not null
    union
    select ${spaceMembers.spaceId} from ${spaceMembers}
    where ${spaceMembers.userId} = ${userId} and ${spaceMembers.status} = 'accepted'
  )`;
  // Everyone on those lists and in those Spaces: owners and accepted members.
  const people = sql`(
    select ${projects.userId} from ${projects} where ${projects.id} in ${shared}
    union
    select ${projectMembers.userId} from ${projectMembers}
    where ${projectMembers.status} = 'accepted' and ${projectMembers.projectId} in ${shared}
    union
    select ${spaceMembers.userId} from ${spaceMembers}
    where ${spaceMembers.status} = 'accepted' and ${spaceMembers.spaceId} in ${mySpaces}
  )`;
  return db
    .select({
      userId: users.id,
      username: users.username,
      displayUsername: users.displayUsername,
      name: users.name,
      email: users.email,
    })
    .from(users)
    .where(
      and(
        sql`${users.id} in ${people}`,
        ne(users.id, userId),
        sql`${users.id} not in ${exclude}`,
      ),
    )
    .orderBy(asc(users.username))
    .all();
}

/**
 * Everyone on a project: the owner first, then every accepted member in
 * invite order, then the list's Space's accepted members (pending invites are
 * excluded — they have no access yet). Each says whether they can edit the
 * list: only those can be assigned its items. Visible to anyone with access;
 * empty for a project the caller can't see.
 */
export function listAssignees(
  db: Db,
  userId: string,
  projectId: string,
): AssigneeView[] {
  const project = getProject(db, userId, projectId);
  if (!project) return [];

  const out: AssigneeView[] = [];
  const owner = getUserById(db, project.userId);
  if (owner) {
    out.push({
      userId: owner.id,
      username: owner.username,
      displayUsername: owner.displayUsername,
      name: owner.name,
      email: owner.email,
      image: owner.image,
      isOwner: true,
      canEdit: true,
    });
  }

  const rows = db
    .select({ user: users, canEdit: sql<boolean>`${projectMembers.role} = 'editor'` })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.status, "accepted"),
      ),
    )
    .orderBy(asc(projectMembers.createdAt))
    .all();
  // Then the Space's accepted members.
  if (project.spaceId) {
    rows.push(
      ...db
        .select({
          user: users,
          canEdit: sql<boolean>`${spaceMembers.role} in ('admin', 'member')`,
        })
        .from(spaceMembers)
        .innerJoin(users, eq(users.id, spaceMembers.userId))
        .where(
          and(
            eq(spaceMembers.spaceId, project.spaceId),
            eq(spaceMembers.status, "accepted"),
          ),
        )
        .orderBy(asc(spaceMembers.createdAt))
        .all(),
    );
  }
  // Someone on the list both directly and through its Space gets the more
  // generous of the two, as listAccess does.
  const byId = new Map(out.map((a) => [a.userId, a]));
  for (const { user, canEdit } of rows) {
    const seen = byId.get(user.id);
    if (seen) {
      seen.canEdit ||= Boolean(canEdit);
      continue;
    }
    const person: AssigneeView = {
      userId: user.id,
      username: user.username,
      displayUsername: user.displayUsername,
      name: user.name,
      email: user.email,
      image: user.image,
      isOwner: false,
      canEdit: Boolean(canEdit),
    };
    byId.set(user.id, person);
    out.push(person);
  }
  return out;
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
