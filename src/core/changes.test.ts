import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { changeSeq, watchChanges } from "./changes";
import { addItem, setItemsCollapsed } from "./items";
import { acceptInvite, inviteMember } from "./members";
import { linkItemToPr, setPrState } from "./prLinks";
import { createProject, deleteProject } from "./projects";
import { createTestDb, createTestUser } from "./test-helpers";
import {
  acceptSpaceInvite,
  createSpace,
  declineSpaceInvite,
  inviteSpaceMember,
  setProjectSpace,
} from "./spaces";
import { setOverdueCollapsed, setTimeZone, setUsername } from "./users";

type Db = ReturnType<typeof createTestDb>["db"];

// Changes are announced once the work in progress finishes.
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe("watchChanges", () => {
  let db: Db;
  let owner: string;
  let member: string;
  let stranger: string;
  let projectId: string;
  const stops: (() => void)[] = [];
  /** How many times each watched user has been told to reload. */
  let heard: Record<string, number>;

  function watch(...userIds: string[]) {
    for (const id of userIds) {
      heard[id] = 0;
      stops.push(watchChanges(db, id, () => heard[id]++));
    }
  }

  beforeEach(async () => {
    db = createTestDb().db;
    heard = {};
    owner = createTestUser(db, { username: "owner" });
    member = createTestUser(db, { username: "member" });
    stranger = createTestUser(db, { username: "stranger" });
    projectId = createProject(db, owner, { name: "Shared" }, "web").id;
    inviteMember(db, owner, projectId, "member", "web");
    acceptInvite(db, member, projectId, "web");
    // The strangers have a list of their own, with nobody else on it.
    createProject(db, stranger, { name: "Theirs" }, "web");
    await settle();
  });

  afterEach(() => {
    for (const stop of stops.splice(0)) stop();
  });

  it("tells everyone on a list about its changes, once per batch, and nobody else", async () => {
    watch(owner, member, stranger);
    addItem(db, owner, { projectId, title: "One" }, "web");
    addItem(db, owner, { projectId, title: "Two" }, "web");
    await settle();
    expect(heard).toEqual({ [owner]: 1, [member]: 1, [stranger]: 0 });
  });

  it("tells a member about the list they lose, and an invitee about the invite", async () => {
    const invitee = createTestUser(db, { username: "invitee" });
    watch(member, invitee);
    inviteMember(db, owner, projectId, "invitee", "web");
    await settle();
    expect(heard).toEqual({ [member]: 1, [invitee]: 1 });

    deleteProject(db, owner, projectId, "web");
    await settle();
    expect(heard).toEqual({ [member]: 2, [invitee]: 2 });
  });

  it("tells collaborators, not strangers, about someone's account changes", async () => {
    watch(owner, stranger);
    setUsername(db, member, "renamed", "web");
    await settle();
    expect(heard).toEqual({ [owner]: 1, [stranger]: 0 });

    // An invitee doesn't show on the list until they accept. (The owner
    // hears the invite they sent, but not the invitee's rename.)
    const invitee = createTestUser(db, { username: "pending" });
    inviteMember(db, owner, projectId, "pending", "web");
    await settle();
    setUsername(db, invitee, "renamed_pending", "web");
    await settle();
    expect(heard).toEqual({ [owner]: 2, [stranger]: 0 });
  });

  it("tells the people in a Space, and its invitees, about its changes", async () => {
    // Nobody here shares a list with the stranger.
    const spaceId = createSpace(db, stranger, { name: "Flat" }, "web").id;
    const flatmate = createTestUser(db, { username: "flatmate" });
    inviteSpaceMember(db, stranger, spaceId, "flatmate", "web");
    acceptSpaceInvite(db, flatmate, spaceId, "web");
    await settle();
    watch(flatmate, member, owner);
    inviteSpaceMember(db, stranger, spaceId, "member", "web");
    await settle();
    expect(heard).toEqual({ [flatmate]: 1, [member]: 1, [owner]: 0 });

    // An invitee hears the admins, who can change the invite, but not
    // another member's rename: they can't see who's in it until they join.
    setUsername(db, flatmate, "renamed_flatmate", "web");
    await settle();
    expect(heard).toEqual({ [flatmate]: 2, [member]: 1, [owner]: 0 });

    // The Space's members see invites listed, so they hear one declined,
    // even by someone they share nothing else with.
    const passerby = createTestUser(db, { username: "passerby" });
    inviteSpaceMember(db, stranger, spaceId, "passerby", "web");
    await settle();
    const before = heard[flatmate];
    declineSpaceInvite(db, passerby, spaceId, "web");
    await settle();
    expect(heard[flatmate]).toBe(before + 1);
    expect(heard[owner]).toBe(0);
  });

  it("tells a list's direct collaborators who joins the Space it's in", async () => {
    // The owner's list is in a Space; the member reaches it directly.
    const spaceId = createSpace(db, owner, { name: "Flat" }, "web").id;
    setProjectSpace(db, owner, projectId, spaceId, "web");
    await settle();
    const flatmate = createTestUser(db, { username: "flatmate" });
    inviteSpaceMember(db, owner, spaceId, "flatmate", "web");
    await settle();
    watch(member, stranger);
    acceptSpaceInvite(db, flatmate, spaceId, "web");
    await settle();
    expect(heard).toEqual({ [member]: 1, [stranger]: 0 });
  });

  it("tells a list about a PR's new state from GitHub, but not a repeat of it", async () => {
    const item = addItem(db, member, { projectId, title: "Ship it" }, "web");
    const pr = "https://github.com/o/r/pull/1";
    linkItemToPr(db, member, item.id, pr, "web");
    await settle();
    watch(member, stranger);
    // The webhook belongs to the owner; the member still sees the badge change.
    setPrState(db, owner, pr, "merged");
    await settle();
    setPrState(db, owner, pr, "merged");
    await settle();
    expect(heard).toEqual({ [member]: 1, [stranger]: 0 });
  });

  it("tells a list about a checklist folding away, but not a repeat of it", async () => {
    const trip = addItem(db, member, { projectId, title: "Trip", subItems: ["Book"] }, "web");
    // Another of the owner's lists, shared with someone else, already folded.
    const other = createTestUser(db, { username: "other" });
    const second = createProject(db, owner, { name: "Second" }, "web").id;
    inviteMember(db, owner, second, "other", "web");
    acceptInvite(db, other, second, "web");
    const move = addItem(db, owner, { projectId: second, title: "Move", subItems: ["Pack"] }, "web");
    setItemsCollapsed(db, owner, [move.id], true);
    await settle();
    watch(member, other, stranger);
    // Unaudited, yet the member sees it fold on the shared list; Second, where
    // nothing changed, doesn't hear about it.
    setItemsCollapsed(db, owner, [trip.id, move.id], true);
    await settle();
    setItemsCollapsed(db, owner, [trip.id], true);
    await settle();
    expect(heard).toEqual({ [member]: 1, [other]: 0, [stranger]: 0 });
  });

  it("tells the user's other pages about folding the Agenda's Overdue section", async () => {
    watch(owner, stranger);
    setOverdueCollapsed(db, owner, true);
    await settle();
    expect(heard).toEqual({ [owner]: 1, [stranger]: 0 });
  });

  // A page reads the number before its data, and skips the events of
  // changes it already shows (LiveUpdates).
  it("numbers each batch above what was read before its changes, and within what's read after", async () => {
    const numbers: number[] = [];
    stops.push(watchChanges(db, owner, (seq) => numbers.push(seq)));
    const before = changeSeq();
    addItem(db, owner, { projectId, title: "One" }, "web");
    addItem(db, owner, { projectId, title: "Two" }, "web");
    const after = changeSeq();
    await settle();
    addItem(db, owner, { projectId, title: "Three" }, "web");
    await settle();
    expect(numbers).toHaveLength(2);
    expect(numbers[0]).toBeGreaterThan(before);
    expect(numbers[0]).toBe(after);
    expect(numbers[1]).toBeGreaterThan(after);
    expect(numbers[1]).toBe(changeSeq());
  });

  // The board reloads to reopen repeating items by the viewer's new day.
  it("tells the user's pages about a new time zone", async () => {
    watch(owner, stranger);
    setTimeZone(db, owner, "Asia/Tokyo");
    await settle();
    expect(heard).toEqual({ [owner]: 1, [stranger]: 0 });
  });
});
