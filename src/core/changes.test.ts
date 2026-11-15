import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { watchChanges } from "./changes";
import { addItem, setItemsCollapsed } from "./items";
import { acceptInvite, inviteMember } from "./members";
import { linkItemToPr, setPrState } from "./prLinks";
import { createProject, deleteProject } from "./projects";
import { createTestDb, createTestUser } from "./test-helpers";
import { setUsername } from "./users";

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
    await settle();
    watch(owner, stranger);
    // Unaudited, yet the owner sees it fold on the shared list.
    setItemsCollapsed(db, member, [trip.id], true);
    await settle();
    setItemsCollapsed(db, member, [trip.id], true);
    await settle();
    expect(heard).toEqual({ [owner]: 1, [stranger]: 0 });
  });
});
