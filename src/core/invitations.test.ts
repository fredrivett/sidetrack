import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { listDayShares } from "./dayShares";
import type { InvitePlace } from "./invites";
import {
  acceptInvitation,
  cancelInvitation,
  findInvitation,
  invitedBy,
  invitedPeople,
  INVITES_PER_DAY,
  inviteByEmail,
  listInvitations,
  resendInvitation,
} from "./invitations";
import { createProject } from "./projects";
import { auditLog, projectMembers } from "./schema";
import { createSpace } from "./spaces";
import { createTestDb, createTestUser } from "./test-helpers";

type Db = ReturnType<typeof createTestDb>["db"];
let db: Db;
let fred: string;
let home: string;

beforeEach(() => {
  db = createTestDb().db;
  fred = createTestUser(db, { username: "fred", name: "Fred" });
  home = createProject(db, fred, { name: "Home" }, "web").id;
});

const dayOn = (id: string, kind: "list" | "space" = "list"): InvitePlace =>
  kind === "list"
    ? { kind, id, role: "commenter", onlyMine: true, within: "week", shareMood: true }
    : { kind, id, role: "commenter", onlyMine: true, within: "week", shareMood: true };

const events = (type: string) =>
  db
    .select()
    .from(auditLog)
    .all()
    .filter((r) => r.event?.type === type);

describe("inviteByEmail", () => {
  it("shares the inviter's day with whoever joins through the link, already accepted", () => {
    const space = createSpace(db, fred, { name: "Family" }, "web").id;
    const { token } = inviteByEmail(db, fred, { email: "Jo@Example.com", places: [dayOn(home), dayOn(space, "space")] }, "web");
    expect(listInvitations(db, fred)).toMatchObject([{ email: "Jo@Example.com", within: "week", mood: true, note: false, places: [{ name: "Home" }, { name: "Family" }] }]);
    expect(events("invitation.sent")[0]).toMatchObject({ actor: fred, entityType: "invitation", action: "create" });

    // Signed up with a different address than the one invited: the link is what counts.
    const jo = createTestUser(db, { username: "jo", email: "jo.other@example.com" });
    expect(acceptInvitation(db, token, jo, "web")).toEqual({ shared: true, within: "week" });

    expect(listDayShares(db, fred)).toMatchObject([
      { personId: jo, within: "week", mood: true, note: false, pending: false, places: [{ kind: "list", name: "Home", pending: false }, { kind: "space", name: "Family", pending: false }] },
    ]);
    expect(listInvitations(db, fred)).toEqual([]);
    expect(findInvitation(db, token)).toMatchObject({ status: "accepted", acceptedBy: jo });
    expect(events("invitation.accepted")[0]).toMatchObject({ actor: jo, event: { inviter: { userId: fred }, shared: true } });
  });

  it("works once: a second account can't use the same link", () => {
    const { token } = inviteByEmail(db, fred, { email: "jo@example.com", places: [dayOn(home)] }, "web");
    acceptInvitation(db, token, createTestUser(db), "web");
    const sam = createTestUser(db);
    expect(() => acceptInvitation(db, token, sam, "web")).toThrow(/expired or been used/);
    expect(db.select().from(projectMembers).where(eq(projectMembers.userId, sam)).all()).toEqual([]);
  });

  it("stops working when it expires, and sending it again makes a new link with its full time", () => {
    const sent = 1_000_000;
    const { id, token } = inviteByEmail(db, fred, { email: "jo@example.com", places: [] }, "web", sent);
    const late = sent + 31 * 24 * 60 * 60 * 1000;
    expect(findInvitation(db, token, late)?.status).toBe("expired");
    expect(listInvitations(db, fred, late)[0].expired).toBe(true);
    expect(() => acceptInvitation(db, token, createTestUser(db), "web", late)).toThrow(/expired/);

    const again = resendInvitation(db, fred, id, "web", late);
    expect(findInvitation(db, token, late)).toBeNull();
    expect(findInvitation(db, again.token, late)?.status).toBe("open");
    // An invite with nothing to share: they just join.
    expect(acceptInvitation(db, again.token, createTestUser(db), "web", late)).toEqual({ shared: false, within: null });
  });

  it("still lets them join when the inviter can no longer share what it named, sharing none of it", () => {
    const fredsSpace = createSpace(db, fred, { name: "Family" }, "web").id;
    const { token } = inviteByEmail(db, fred, { email: "jo@example.com", places: [dayOn(home), dayOn(fredsSpace, "space")] }, "web");
    // Fred is no longer the Space's admin: say it's gone.
    db.delete(projectMembers).run();
    db.run(`delete from space_members where space_id = '${fredsSpace}'`);
    const jo = createTestUser(db);
    expect(acceptInvitation(db, token, jo, "web")).toEqual({ shared: false, within: "week" });
    // Home alone would still have worked, but it's all or nothing.
    expect(db.select().from(projectMembers).where(and(eq(projectMembers.userId, jo), eq(projectMembers.projectId, home))).all()).toEqual([]);
    expect(findInvitation(db, token)?.status).toBe("accepted");
  });

  it("refuses what an invite to someone with an account would, and people already on Sidetrack", () => {
    const zoe = createTestUser(db, { email: "zoe@example.com" });
    expect(() => inviteByEmail(db, fred, { email: "ZOE@example.com", places: [] }, "web")).toThrow(/on Sidetrack already/);
    expect(() => inviteByEmail(db, fred, { email: "not an email", places: [] }, "web")).toThrow(/isn't an email/);
    const zoesList = createProject(db, zoe, { name: "Zoe's" }, "web").id;
    expect(() => inviteByEmail(db, fred, { email: "jo@example.com", places: [dayOn(zoesList)] }, "web")).toThrow(/not found/);
    expect(() => inviteByEmail(db, fred, { email: "jo@example.com", places: [{ kind: "list", id: home, role: "editor", onlyMine: true }] }, "web")).toThrow(/only viewers and commenters/);
    inviteByEmail(db, fred, { email: "jo@example.com", places: [] }, "web");
    expect(() => inviteByEmail(db, fred, { email: "JO@example.com", places: [] }, "web")).toThrow(/invited jo@example.com already/i);
    expect(listInvitations(db, fred)).toHaveLength(1);
  });

  it("can't be accepted by the inviter, or sent again or cancelled by anyone else", () => {
    const { id, token } = inviteByEmail(db, fred, { email: "jo@example.com", places: [] }, "web");
    expect(() => acceptInvitation(db, token, fred, "web")).toThrow(/your own invite/);
    const zoe = createTestUser(db);
    expect(() => resendInvitation(db, zoe, id, "web")).toThrow(/accepted or cancelled/);
    expect(() => cancelInvitation(db, zoe, id, "web")).toThrow(/accepted or cancelled/);
    cancelInvitation(db, fred, id, "web");
    expect(findInvitation(db, token)).toBeNull();
    expect(events("invitation.cancelled")[0]).toMatchObject({ actor: fred, action: "delete", entityId: id });
  });

  it(`sends at most ${INVITES_PER_DAY} a day, resends included, and more the next day`, () => {
    // The audit rows the cap counts are stamped with the clock, so move it.
    const start = Date.UTC(2026, 10, 22, 9);
    vi.useFakeTimers({ now: start, toFake: ["Date"] });
    try {
      const { id } = inviteByEmail(db, fred, { email: "a0@example.com", places: [] }, "web");
      for (let i = 1; i < INVITES_PER_DAY - 1; i++) inviteByEmail(db, fred, { email: `a${i}@example.com`, places: [] }, "web");
      resendInvitation(db, fred, id, "web");
      vi.setSystemTime(start + 23 * 60 * 60 * 1000);
      expect(() => inviteByEmail(db, fred, { email: "one-more@example.com", places: [] }, "web")).toThrow(/20 invites a day/);
      vi.setSystemTime(start + 25 * 60 * 60 * 1000);
      inviteByEmail(db, fred, { email: "one-more@example.com", places: [] }, "web");
      expect(listInvitations(db, fred)).toHaveLength(INVITES_PER_DAY);
    } finally {
      vi.useRealTimers();
    }
  });

  it("isn't sent again to someone who has joined meanwhile", () => {
    const { id } = inviteByEmail(db, fred, { email: "jo@example.com", places: [] }, "web");
    createTestUser(db, { email: "jo@example.com" });
    expect(() => resendInvitation(db, fred, id, "web")).toThrow(/on Sidetrack already/);
  });

  it("says who invited whom, for those who joined through the invite, not those already here", () => {
    const first = inviteByEmail(db, fred, { email: "jo@example.com", places: [] }, "web");
    const jo = createTestUser(db, { username: "jo", name: "Jo" });
    acceptInvitation(db, first.token, jo, "web");
    // Already on Sidetrack an hour and more before opening Fred's link.
    const sam = createTestUser(db, { username: "sam" });
    const late = inviteByEmail(db, fred, { email: "sam@example.com", places: [] }, "web");
    acceptInvitation(db, late.token, sam, "web", Date.now() + 2 * 60 * 60 * 1000);
    // Jo invites someone in turn.
    const kim = createTestUser(db, { username: "kim" });
    acceptInvitation(db, inviteByEmail(db, jo, { email: "kim@example.com", places: [] }, "web").token, kim, "web");

    expect(invitedBy(db, jo)).toMatchObject({ userId: fred, name: "Fred" });
    expect(invitedBy(db, kim)).toMatchObject({ userId: jo });
    expect(invitedBy(db, sam)).toBeNull();
    expect(invitedBy(db, fred)).toBeNull();
    expect(invitedPeople(db, fred).map((p) => p.userId)).toEqual([jo]);
    expect(invitedPeople(db, jo).map((p) => p.userId)).toEqual([kim]);
  });
});
