// Invites by email for someone not on Sidetrack yet: from Share my day,
// with the places it shares, or Invite a friend, with none. The email's
// link carries a token, and only its hash is kept, so the link is the only
// way in: accounts' emails aren't verified, so someone signing up as the
// address invited proves nothing. Signing up through the link (or opening it
// signed in) makes the memberships the invite describes, as if the inviter
// invited them then (invitePeople, which checks the inviter still may), and
// accepts them.

import { createHash, randomBytes } from "node:crypto";
import { and, count, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { type AuditOrigin, recordAudit } from "./audit";
import { users } from "./auth-schema";
import type { Db } from "./db";
import { type InvitePlace, invitePeople } from "./invites";
import { acceptInvite, checkListInvite, findUserByHandle, getUserById, personAt } from "./members";
import { auditLog, invitations, type OnlyWithin, projects, spaces } from "./schema";
import { acceptSpaceInvite, checkSpaceInvite } from "./spaces";

/** How long a link works: from when it was sent, or last sent again. */
export const INVITE_DAYS = 30;
/** Invites anyone can send (or send again) in a day: each is an email to a stranger. */
export const INVITES_PER_DAY = 20;
const DAY = 24 * 60 * 60 * 1000;

/** An invite the user sent that nobody has accepted yet, for showing them. */
export type InvitationView = {
  id: string;
  email: string;
  /** The places it shares, by their names now; none for Invite a friend. */
  places: { kind: "list" | "space"; id: string; name: string }[];
  /** Set when it shares the user's day: today or this week. */
  within: OnlyWithin | null;
  note: boolean;
  mood: boolean;
  createdAt: number;
  expiresAt: number;
  expired: boolean;
};

/** An invite as its link shows it, to whoever opens it. */
export type InvitationLink = {
  id: string;
  email: string;
  inviter: { id: string; name: string; username: string | null; image: string | null };
  places: string[];
  within: OnlyWithin | null;
  status: "open" | "expired" | "accepted";
  acceptedBy: string | null;
};

/** An invite just sent: its link's token, and what the email says it shares. */
export type SentInvitation = { id: string; email: string; token: string; places: string[]; within: OnlyWithin | null };

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

function validEmail(raw: string): string {
  const email = raw.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`"${email}" isn't an email address`);
  return email;
}

/** One per place, each checked as the inviter would be if inviting someone now; with each place's name. */
function checkPlaces(db: Db, userId: string, raw: InvitePlace[]) {
  const places = raw.filter((p, i) => raw.findIndex((q) => q.kind === p.kind && q.id === p.id) === i);
  const names = places.map((p) =>
    p.kind === "list"
      ? checkListInvite(db, userId, p.id, p.role, p).project.name
      : checkSpaceInvite(db, userId, p.id, p.role, p).space.name,
  );
  return { places, names };
}

function assertUnderDailyLimit(db: Db, userId: string, now: number) {
  const sent =
    db
      .select({ n: count() })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.actor, userId),
          eq(auditLog.entityType, "invitation"),
          inArray(sql`json_extract(${auditLog.event}, '$.type')`, ["invitation.sent", "invitation.resent"]),
          gt(auditLog.ts, now - DAY),
        ),
      )
      .get()?.n ?? 0;
  if (sent >= INVITES_PER_DAY) throw new Error(`you can send ${INVITES_PER_DAY} invites a day; try again tomorrow`);
}

function ownOpenInvitation(db: Db, userId: string, id: string) {
  const row = db.select().from(invitations).where(eq(invitations.id, id)).get();
  if (!row || row.inviterId !== userId || row.acceptedBy) throw new Error("this invite was accepted or cancelled already");
  return row;
}

/** Whose day an invite shares, and how much: from its places, which share it the same way. */
function dayOf(places: InvitePlace[]) {
  const day = places.find((p) => p.within);
  return { within: day?.within ?? null, note: !!day?.shareNote, mood: !!day?.shareMood };
}

/**
 * Invite someone without an account by email, to Sidetrack and, with
 * `places`, to those places, as invitePeople would invite them (the same
 * checks, now and again when they join). Returns the link's token, for the
 * email; only its hash is kept.
 */
export function inviteByEmail(
  db: Db,
  userId: string,
  input: { email: string; places: InvitePlace[] },
  source: AuditOrigin,
  now = Date.now(),
): SentInvitation {
  const email = validEmail(input.email);
  if (findUserByHandle(db, email)) throw new Error(`${email} is on Sidetrack already`);
  const open = db
    .select({ id: invitations.id })
    .from(invitations)
    .where(
      and(
        eq(invitations.inviterId, userId),
        sql`lower(${invitations.email}) = ${email.toLowerCase()}`,
        isNull(invitations.acceptedBy),
      ),
    )
    .get();
  if (open) throw new Error(`you've invited ${email} already; send that invite again, or cancel it first`);
  const { places, names } = checkPlaces(db, userId, input.places);
  assertUnderDailyLimit(db, userId, now);

  const id = nanoid(12);
  const token = randomBytes(24).toString("base64url");
  const day = dayOf(places);
  db.transaction((tx) => {
    tx.insert(invitations)
      .values({ id, inviterId: userId, email, tokenHash: hash(token), places, createdAt: now, expiresAt: now + INVITE_DAYS * DAY })
      .run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      event: { type: "invitation.sent", invitationId: id, email, places: names, ...(day.within ? { within: day.within } : {}) },
    });
  });
  return { id, email, token, places: names, within: day.within };
}

/** Send an invite again, with a new link: the old one stops working, and the new one has its full time. */
export function resendInvitation(
  db: Db,
  userId: string,
  id: string,
  source: AuditOrigin,
  now = Date.now(),
): SentInvitation {
  const row = ownOpenInvitation(db, userId, id);
  if (findUserByHandle(db, row.email)) throw new Error(`${row.email} is on Sidetrack already; share with them by their username`);
  assertUnderDailyLimit(db, userId, now);
  const token = randomBytes(24).toString("base64url");
  db.transaction((tx) => {
    tx.update(invitations)
      .set({ tokenHash: hash(token), expiresAt: now + INVITE_DAYS * DAY })
      .where(eq(invitations.id, id))
      .run();
    recordAudit(tx as unknown as Db, { actor: userId, source, event: { type: "invitation.resent", invitationId: id, email: row.email } });
  });
  const names = placeNames(db, row.places);
  return { id, email: row.email, token, places: row.places.map((p) => names.get(p.id) ?? ""), within: dayOf(row.places).within };
}

/** Cancel an invite nobody has accepted: its link stops working. */
export function cancelInvitation(db: Db, userId: string, id: string, source: AuditOrigin): void {
  const row = ownOpenInvitation(db, userId, id);
  db.transaction((tx) => {
    tx.delete(invitations).where(eq(invitations.id, id)).run();
    recordAudit(tx as unknown as Db, { actor: userId, source, event: { type: "invitation.cancelled", invitationId: id, email: row.email } });
  });
}

/** The invites the user sent that nobody has accepted yet, newest first. */
export function listInvitations(db: Db, userId: string, now = Date.now()): InvitationView[] {
  const rows = db
    .select()
    .from(invitations)
    .where(and(eq(invitations.inviterId, userId), isNull(invitations.acceptedBy)))
    .orderBy(desc(invitations.createdAt))
    .all();
  const names = placeNames(db, rows.flatMap((r) => r.places));
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    places: r.places.map((p) => ({ kind: p.kind, id: p.id, name: names.get(p.id) ?? "" })),
    ...dayOf(r.places),
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    expired: r.expiresAt <= now,
  }));
}

function placeNames(db: Db, places: InvitePlace[]) {
  const listIds = places.filter((p) => p.kind === "list").map((p) => p.id);
  const spaceIds = places.filter((p) => p.kind === "space").map((p) => p.id);
  return new Map([
    ...(listIds.length ? db.select({ id: projects.id, name: projects.name }).from(projects).where(inArray(projects.id, listIds)).all() : []),
    ...(spaceIds.length ? db.select({ id: spaces.id, name: spaces.name }).from(spaces).where(inArray(spaces.id, spaceIds)).all() : []),
  ].map((r) => [r.id, r.name] as const));
}

/** The invite a link's token is for, as its page shows it; null for a token that's no invite's (or no longer is). */
export function findInvitation(db: Db, token: string, now = Date.now()): InvitationLink | null {
  if (!token) return null;
  const row = db.select().from(invitations).where(eq(invitations.tokenHash, hash(token))).get();
  if (!row) return null;
  const inviter = db
    .select({ id: users.id, name: users.name, username: users.displayUsername, image: users.image })
    .from(users)
    .where(eq(users.id, row.inviterId))
    .get();
  const names = placeNames(db, row.places);
  return {
    id: row.id,
    email: row.email,
    inviter: inviter ?? { id: row.inviterId, name: "Someone", username: null, image: null },
    places: row.places.map((p) => names.get(p.id)).filter((n): n is string => !!n),
    within: dayOf(row.places).within,
    status: row.acceptedBy ? "accepted" : row.expiresAt <= now ? "expired" : "open",
    acceptedBy: row.acceptedBy,
  };
}

/**
 * Accept an invite as `userId`, by its link's token: they're in the places it
 * shares, already accepted, as if the inviter had invited them now. Should
 * the inviter no longer be able to share one of them, it shares none of them
 * (`shared` false), but the invite still counts as accepted.
 */
export function acceptInvitation(
  db: Db,
  token: string,
  userId: string,
  source: AuditOrigin,
  now = Date.now(),
): { shared: boolean; within: OnlyWithin | null } {
  const row = db.select().from(invitations).where(eq(invitations.tokenHash, hash(token))).get();
  if (!row || row.acceptedBy || row.expiresAt <= now) throw new Error("this invite has expired or been used");
  if (row.inviterId === userId) throw new Error("this is your own invite");
  const user = getUserById(db, userId);
  if (!user) throw new Error(`no account: ${userId}`);
  const inviter = getUserById(db, row.inviterId);
  return db.transaction((tx) => {
    // Only if still open, so the same link can't be accepted twice at once.
    const claimed = tx
      .update(invitations)
      .set({ acceptedBy: userId, acceptedAt: now })
      .where(and(eq(invitations.id, row.id), isNull(invitations.acceptedBy)))
      .run();
    if (claimed.changes === 0) throw new Error("this invite has expired or been used");
    let shared = row.places.length > 0;
    if (shared) {
      try {
        // A savepoint: if the inviter can't share these any more, none of them are.
        (tx as unknown as Db).transaction((inner) => {
          const sp = inner as unknown as Db;
          invitePeople(sp, row.inviterId, { people: [user.email], places: row.places }, source);
          for (const p of row.places) {
            if (p.kind === "list") acceptInvite(sp, userId, p.id, source);
            else acceptSpaceInvite(sp, userId, p.id, source);
          }
        });
      } catch {
        shared = false;
      }
    }
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      event: {
        type: "invitation.accepted",
        invitationId: row.id,
        inviter: personAt(inviter ?? { id: row.inviterId, username: null }),
        shared,
      },
    });
    return { shared, within: dayOf(row.places).within };
  });
}
