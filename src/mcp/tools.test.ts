import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { listAudit } from "@/core/audit";
import { addItem, completeItem, getItem, listItems } from "@/core/items";
import { listLabels } from "@/core/labels";
import { acceptInvite, inviteMember } from "@/core/members";
import { createProject, getProject, listProjects } from "@/core/projects";
import {
  acceptSpaceInvite,
  createSpace,
  inviteSpaceMember,
  listPendingSpaceInvites,
  listTrays,
  setSpaceMemberRole,
} from "@/core/spaces";
import { createTestDb, createTestUser } from "@/core/test-helpers";
import { setTimeZone } from "@/core/users";
import { buildServer } from "./server";

// The tools run against a real in-memory DB through a real MCP client, as an
// agent would call them. Only the DB singleton and env are stubbed: no
// TYPESAFE_API_KEY, so add_item skips its AI duplicate check.
const ctx = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/core/db", () => ({ getDb: () => ({ db: ctx.db }) }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({}) }));

type Db = ReturnType<typeof createTestDb>["db"];
let db: Db;

const AGENT = { keyId: "key-1", name: "Test agent" };

beforeEach(() => {
  db = createTestDb().db;
  ctx.db = db;
});

afterEach(() => {
  vi.useRealTimers();
});

/** Connect an MCP client as `userId` and return a tool caller. */
async function connectAs(userId: string) {
  const server = buildServer({ userId, agent: AGENT, baseUrl: "http://localhost:3000" });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as { type: string; text: string }[])[0].text;
    if (result.isError) return { error: text, data: {} as Record<string, unknown> };
    return { error: null, data: JSON.parse(text) as Record<string, unknown> };
  };
}

describe("tool output", () => {
  it("speaks of lists, not projects, at every depth", async () => {
    const fred = createTestUser(db, { username: "fred" });
    const bob = createTestUser(db, { username: "bob" });
    const list = createProject(db, fred, { name: "Home" }, "web");
    const parent = addItem(db, fred, { projectId: list.id, title: "Tidy flat" }, "web");
    addItem(db, fred, { projectId: list.id, title: "Kitchen", parentId: parent.id }, "web");
    inviteMember(db, fred, list.id, "bob", "web");
    const space = createSpace(db, fred, { name: "Household" }, "web");
    inviteSpaceMember(db, fred, space.id, "bob", "web");

    const call = await connectAs(fred);
    const { data } = await call("get_item", { id: "HOM-1" });
    expect(data).toMatchObject({ id: parent.id, listId: list.id, ref: "HOM-1" });
    expect(data).not.toHaveProperty("projectId");
    // Sub-items in `children` are renamed too.
    const [child] = data.children as Record<string, unknown>[];
    expect(child).toMatchObject({ title: "Kitchen", listId: list.id, ref: "HOM-2" });
    expect(child).not.toHaveProperty("projectId");

    const invites = await (await connectAs(bob))("list_pending_invites");
    expect(invites.data).toEqual({
      spaces: [expect.objectContaining({ spaceId: space.id, spaceName: "Household" })],
      lists: [expect.objectContaining({ listId: list.id, listName: "Home" })],
    });
    expect((invites.data.lists as object[])[0]).not.toHaveProperty("projectName");
  });

  it("gives a repeat rule as one field, and a finished repeat the day it comes back in the user's zone", async () => {
    const fred = createTestUser(db, { username: "fred" });
    setTimeZone(db, fred, "Pacific/Auckland");
    const list = createProject(db, fred, { name: "Home" }, "web");
    const call = await connectAs(fred);
    const added = await call("add_item", {
      list_id: list.id,
      title: "Water plants",
      repeat: { every: 2, unit: "day" },
    });
    const created = added.data.created as Record<string, unknown>;
    expect(created.repeat).toEqual({ every: 2, unit: "day" });
    expect(created).not.toHaveProperty("repeatEvery");
    expect(created).not.toHaveProperty("repeatUnit");
    // An open repeating item has no return day.
    expect(created).not.toHaveProperty("comesBack");

    // 20:00 UTC on the 15th is 9am on the 16th in Auckland (UTC+13), so
    // two days on is the 18th there, not the 17th it would be in UTC.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-15T20:00:00Z"));
    const done = await call("complete_item", { id: "HOM-1" });
    expect(done.data).toMatchObject({ repeat: { every: 2, unit: "day" }, comesBack: "2026-11-18" });
  });

  it("takes and gives a monthly rule's day of the month", async () => {
    const fred = createTestUser(db, { username: "fred" });
    const list = createProject(db, fred, { name: "Home" }, "web");
    const call = await connectAs(fred);
    const added = await call("add_item", {
      list_id: list.id,
      title: "Pay rent",
      repeat: { every: 1, unit: "month", day: 1 },
    });
    expect((added.data.created as Record<string, unknown>).repeat).toEqual({ every: 1, unit: "month", day: 1 });
    expect(added.data.created).not.toHaveProperty("repeatDay");

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-21T12:00:00Z"));
    expect((await call("complete_item", { id: "HOM-1" })).data.comesBack).toBe("2026-12-01");
  });

  it("counts the return day in UTC when the user's zone isn't known", async () => {
    const fred = createTestUser(db, { username: "fred" });
    const list = createProject(db, fred, { name: "Home" }, "web");
    addItem(db, fred, { projectId: list.id, title: "Water plants", repeat: { every: 2, unit: "day" } }, "web");
    addItem(db, fred, { projectId: list.id, title: "Post letter" }, "web");
    const call = await connectAs(fred);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-15T20:00:00Z"));
    expect((await call("complete_item", { id: "HOM-1" })).data.comesBack).toBe("2026-11-17");
    // A finished item that doesn't repeat never comes back.
    const once = await call("complete_item", { id: "HOM-2" });
    expect(once.data).toMatchObject({ repeat: null });
    expect(once.data).not.toHaveProperty("comesBack");
  });
});

describe("list roles", () => {
  it("says what the user can do on each list, and a viewer's change is an error that changes nothing", async () => {
    const lorna = createTestUser(db, { username: "lorna" });
    const jo = createTestUser(db, { username: "jo" });
    const list = createProject(db, lorna, { name: "Life" }, "web");
    addItem(db, lorna, { projectId: list.id, title: "Swim" }, "web");
    const asLorna = await connectAs(lorna);
    expect(
      (await asLorna("invite_member", { list_id: list.id, person: "jo", role: "viewer" })).data,
    ).toMatchObject({ role: "viewer", status: "pending" });
    acceptInvite(db, jo, list.id, "web");

    const asJo = await connectAs(jo);
    expect((await asJo("list_lists")).data).toEqual([expect.objectContaining({ id: list.id, access: "view" })]);
    expect((await asJo("complete_item", { id: "LIF-1" })).error).toMatch(/view this list but not change it/);
    expect(getItem(db, lorna, (await asLorna("get_item", { id: "LIF-1" })).data.id as string)?.completedAt).toBeNull();

    expect((await asLorna("set_member_role", { list_id: list.id, user_id: jo, role: "editor" })).error).toBeNull();
    expect((await asJo("complete_item", { id: "LIF-1" })).error).toBeNull();
  });
});

describe("invite_people", () => {
  it("invites several people to a list and a Space in one go, or to none when one place fails", async () => {
    const lorna = createTestUser(db, { username: "lorna" });
    const jo = createTestUser(db, { username: "jo" });
    createTestUser(db, { username: "kim" });
    const list = createProject(db, lorna, { name: "Life" }, "web");
    const space = createSpace(db, lorna, { name: "Home" }, "web");
    const call = await connectAs(lorna);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const sent = await call("invite_people", {
        people: ["jo", "@kim"],
        places: [{ list_id: list.id, role: "viewer" }, { space_id: space.id, role: "commenter" }],
      });
      expect(sent.error).toBeNull();
      expect(sent.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ list_id: list.id, userId: jo, role: "viewer", status: "pending" }),
          expect.objectContaining({ space_id: space.id, userId: jo, role: "commenter", status: "pending" }),
        ]),
      );
      expect(sent.data).toHaveLength(4);
      // Jo is already invited to Life, so this fails, and Kim isn't invited to Garden either.
      const garden = createProject(db, lorna, { name: "Garden" }, "web");
      const again = await call("invite_people", {
        people: ["kim", "jo"],
        places: [{ list_id: garden.id }, { list_id: list.id }],
      });
      expect(again.error).toMatch(/already pending/);
      expect((await call("list_members", { list_id: garden.id })).data).toEqual([]);
    } finally {
      log.mockRestore();
    }
  });
});

describe("emails", () => {
  it("link invites to the app's address the request came in on", async () => {
    const fred = createTestUser(db, { username: "fred" });
    createTestUser(db, { username: "bob" });
    const list = createProject(db, fred, { name: "Home" }, "web");
    const space = createSpace(db, fred, { name: "Household" }, "web");
    // With no email transport set, the email layer logs each link instead.
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const call = await connectAs(fred);
      expect((await call("invite_member", { list_id: list.id, person: "bob" })).error).toBeNull();
      expect((await call("invite_space_member", { space_id: space.id, person: "bob" })).error).toBeNull();
      const invites = log.mock.calls.map(([line]) => String(line)).filter((l) => l.includes("invite for"));
      expect(invites).toHaveLength(2);
      for (const line of invites) expect(line).toMatch(/: http:\/\/localhost:3000$/);
    } finally {
      log.mockRestore();
    }
  });
});

describe("item targeting", () => {
  // Fred shares his ENG list with Bob, who has an ENG list of his own, so a
  // bare ENG-1 could be either on Bob's board.
  function clashingLists() {
    const fred = createTestUser(db, { username: "fred" });
    const bob = createTestUser(db, { username: "bob" });
    const shared = createProject(db, fred, { name: "Engineering" }, "web");
    inviteMember(db, fred, shared.id, "bob", "web");
    acceptInvite(db, bob, shared.id, "web");
    const own = createProject(db, bob, { name: "Engines" }, "web");
    const fredsItem = addItem(db, fred, { projectId: shared.id, title: "Fix login" }, "web");
    const bobsItem = addItem(db, bob, { projectId: own.id, title: "Oil change" }, "web");
    return { bob, fredsItem, bobsItem };
  }

  it("refuses an ambiguous ref, naming the qualified refs, and changes nothing", async () => {
    const { bob, fredsItem, bobsItem } = clashingLists();
    const auditBefore = listAudit(db, bob, { limit: 500 }).length;
    const call = await connectAs(bob);

    const { error } = await call("complete_item", { id: "ENG-1" });
    expect(error).toMatch(/Ambiguous item ref "ENG-1"/);
    expect(error).toContain("fred/ENG-N");
    expect(error).toContain("bob/ENG-N");
    expect(error).toContain("no change was made");
    expect(getItem(db, bob, fredsItem.id)?.completedAt).toBeNull();
    expect(getItem(db, bob, bobsItem.id)?.completedAt).toBeNull();
    expect(listAudit(db, bob, { limit: 500 })).toHaveLength(auditBefore);
  });

  it("resolves an owner-qualified ref to that owner's item and shows the qualified ref", async () => {
    const { bob, fredsItem, bobsItem } = clashingLists();
    const call = await connectAs(bob);

    const { data } = await call("complete_item", { id: "fred/ENG-1" });
    expect(data).toMatchObject({ id: fredsItem.id, ref: "fred/ENG-1" });
    expect(getItem(db, bob, bobsItem.id)?.completedAt).toBeNull();
  });

  it("returns not found for an unknown ref or an item the caller can't see", async () => {
    const fred = createTestUser(db, { username: "fred" });
    const eve = createTestUser(db, { username: "eve" });
    const list = createProject(db, fred, { name: "Home" }, "web");
    const item = addItem(db, fred, { projectId: list.id, title: "Secret" }, "web");

    expect((await (await connectAs(fred))("get_item", { id: "HOM-9" })).error).toBe(
      "item not found: HOM-9",
    );
    const asEve = await connectAs(eve);
    expect((await asEve("delete_item", { id: item.id })).error).toBe(`item not found: ${item.id}`);
    expect(getItem(db, fred, item.id)).toBeDefined();
  });

  it("logs a change as the agent's API key", async () => {
    const fred = createTestUser(db, { username: "fred" });
    const list = createProject(db, fred, { name: "Home" }, "web");
    const item = addItem(db, fred, { projectId: list.id, title: "Post letter" }, "web");

    await (await connectAs(fred))("complete_item", { id: "HOM-1" });
    expect(listAudit(db, fred, { limit: 1 })[0]).toMatchObject({
      source: "mcp",
      action: "complete",
      entityId: item.id,
      agentKeyId: AGENT.keyId,
      agentName: AGENT.name,
    });
  });
});

describe("positions", () => {
  function homeList() {
    const fred = createTestUser(db, { username: "fred" });
    const list = createProject(db, fred, { name: "Home" }, "web");
    const add = (title: string, parentId?: string) =>
      addItem(db, fred, { projectId: list.id, title, parentId }, "web");
    return { fred, list, add };
  }
  const titles = (db: Db, userId: string, listId: string) =>
    listItems(db, userId, listId)
      .filter((i) => i.parentId === null)
      .map((i) => i.title);

  it("places an item after or before a sibling named by ref", async () => {
    const { fred, list, add } = homeList();
    add("A"); // HOM-1
    add("B"); // HOM-2
    add("C"); // HOM-3
    const call = await connectAs(fred);

    await call("add_item", { list_id: list.id, title: "New", position: "after:HOM-1" });
    expect(titles(db, fred, list.id)).toEqual(["A", "New", "B", "C"]);
    await call("reorder_item", { id: "HOM-1", position: "before:HOM-3" });
    expect(titles(db, fred, list.id)).toEqual(["New", "B", "A", "C"]);
    await call("reorder_item", { id: "HOM-3", position: "top" });
    expect(titles(db, fred, list.id)).toEqual(["C", "New", "B", "A"]);
  });

  it("refuses a priority sort with AI off and leaves the order alone", async () => {
    const { fred, list, add } = homeList();
    add("B");
    add("A");
    const call = await connectAs(fred);

    const { error } = await call("sort_items", { list_id: list.id, by: "priority" });
    expect(error).toMatch(/Couldn't rank the items by priority.*no change was made/);
    expect(titles(db, fred, list.id)).toEqual(["B", "A"]);
  });

  it("refuses an anchor in another list and adds nothing", async () => {
    const { fred, list, add } = homeList();
    add("A");
    const other = createProject(db, fred, { name: "Work" }, "web");
    addItem(db, fred, { projectId: other.id, title: "Elsewhere" }, "web"); // WOR-1
    const call = await connectAs(fred);

    const { error } = await call("add_item", { list_id: list.id, title: "New", position: "after:WOR-1" });
    expect(error).toMatch(/"WOR-1" is in a different list.*no change was made/);
    expect(titles(db, fred, list.id)).toEqual(["A"]);
  });

  it("refuses an anchor that isn't a sibling and leaves the order alone", async () => {
    const { fred, list, add } = homeList();
    const parent = add("Tidy flat"); // HOM-1
    add("Kitchen", parent.id); // HOM-2
    add("Shop"); // HOM-3
    const call = await connectAs(fred);

    const { error } = await call("reorder_item", { id: "HOM-3", position: "before:HOM-2" });
    expect(error).toMatch(/"HOM-2" is a sub-item of another item.*set_item_parent/);
    expect(titles(db, fred, list.id)).toEqual(["Tidy flat", "Shop"]);
  });

  it("rejects a position that isn't top, end, after: or before:", async () => {
    const { fred, list, add } = homeList();
    add("A");
    const call = await connectAs(fred);

    const { error } = await call("add_item", { list_id: list.id, title: "New", position: "middle" });
    expect(error).toContain("expected top|end|after:<item>|before:<item>");
    expect(titles(db, fred, list.id)).toEqual(["A"]);
  });
});

describe("error results", () => {
  it("turns a refused core change into an error that says nothing changed", async () => {
    const fred = createTestUser(db, { username: "fred" });
    const list = createProject(db, fred, { name: "Home" }, "web");
    const parent = addItem(db, fred, { projectId: list.id, title: "Tidy flat" }, "web");
    addItem(db, fred, { projectId: list.id, title: "Kitchen", parentId: parent.id }, "web");
    addItem(db, fred, { projectId: list.id, title: "Shop" }, "web"); // HOM-3
    const call = await connectAs(fred);

    // An item with sub-items can't become one.
    const { error } = await call("set_item_parent", { id: "HOM-1", parent: "HOM-3" });
    expect(error).toBe(`"Tidy flat" has sub-items, so it can't become one — no change was made.`);
    expect(getItem(db, fred, parent.id)?.parentId).toBeNull();
  });

  it("refuses conflicting inputs before changing anything", async () => {
    const fred = createTestUser(db, { username: "fred" });
    const list = createProject(db, fred, { name: "Home" }, "web");
    addItem(db, fred, { projectId: list.id, title: "Tidy flat" }, "web");
    const call = await connectAs(fred);

    // Supplied counts, even empty: an empty checklist is still a checklist.
    for (const sub_items of [["Milk"], []]) {
      const both = await call("add_item", {
        list_id: list.id,
        title: "Shop",
        parent: "HOM-1",
        sub_items,
      });
      expect(both.error).toMatch(/Pass parent or sub_items, not both/);
    }
    expect(listItems(db, fred, list.id)).toHaveLength(1);

    const clash = await call("update_item", {
      id: "HOM-1",
      add_assignee_ids: ["me"],
      remove_assignee_ids: [fred],
    });
    expect(clash.error).toBe(`${fred} is in both add_assignee_ids and remove_assignee_ids — no change was made.`);
    expect(getItem(db, fred, listItems(db, fred, list.id)[0].id)?.assigneeIds).toEqual([]);

    // An invite answer names one invite: a Space or a list, not both or neither.
    const bob = createTestUser(db, { username: "bob" });
    const space = createSpace(db, fred, { name: "Household" }, "web");
    inviteSpaceMember(db, fred, space.id, "bob", "web");
    inviteMember(db, fred, list.id, "bob", "web");
    const asBob = await connectAs(bob);
    for (const args of [{ space_id: space.id, list_id: list.id }, {}]) {
      for (const tool of ["accept_invite", "decline_invite"]) {
        const r = await asBob(tool, args);
        expect(r.error).toBe("Pass exactly one of list_id or space_id — no change was made.");
      }
    }
    // An empty id isn't a missing one: it's refused, not ignored.
    for (const tool of ["accept_invite", "decline_invite"]) {
      expect((await asBob(tool, { space_id: "", list_id: list.id })).error).toBeTruthy();
    }
    expect(listPendingSpaceInvites(db, bob)).toHaveLength(1);
    expect(getProject(db, bob, list.id)).toBeUndefined();

    // Nor does create_list take an empty space_id as "no Space" and make a private list.
    const before = listProjects(db, fred).length;
    expect((await call("create_list", { name: "Shared", space_id: "" })).error).toBeTruthy();
    expect(listProjects(db, fred)).toHaveLength(before);
  });

  it("moves a list between Spaces after its other edits, and says when the caller loses it", async () => {
    const fred = createTestUser(db, { username: "fred" });
    const bob = createTestUser(db, { username: "bob" });
    const home = createSpace(db, fred, { name: "Household" }, "web");
    const work = createSpace(db, fred, { name: "Work" }, "web");
    inviteSpaceMember(db, fred, home.id, "bob", "web");
    acceptSpaceInvite(db, bob, home.id, "web");
    setSpaceMemberRole(db, fred, home.id, bob, "admin", "web");
    const list = createProject(db, fred, { name: "Chores", spaceId: work.id }, "web");

    // The owner renames and moves in one call; both show in what comes back.
    const moved = await (await connectAs(fred))("update_list", {
      id: list.id,
      name: "House chores",
      space_id: home.id,
    });
    expect(moved.data).toMatchObject({ id: list.id, name: "House chores", spaceId: home.id });

    // A Space admin can take out a list they don't own, and with it their access.
    const out = await (await connectAs(bob))("update_list", { id: list.id, space_id: null });
    expect(out.data).toEqual({ id: list.id, note: expect.stringMatching(/no longer has access/) });
    expect(getProject(db, fred, list.id)?.spaceId).toBeNull();
    expect(getProject(db, bob, list.id)).toBeUndefined();
  });

  it("moves a Space or Personal on the caller's board, and refuses a move it can't make", async () => {
    const fred = createTestUser(db, { username: "fred" });
    const eve = createTestUser(db, { username: "eve" });
    const home = createSpace(db, fred, { name: "Household" }, "web");
    const work = createSpace(db, fred, { name: "Work" }, "web");
    const hers = createSpace(db, eve, { name: "Eve's" }, "web");
    const call = await connectAs(fred);

    const moved = await call("reorder_space", { space_id: "personal", position: `after:${work.id}` });
    expect(moved.data).toEqual([home.id, work.id, "personal"]);
    const anchored = await call("reorder_space", { space_id: home.id, position: "after:personal" });
    expect(anchored.data).toEqual([work.id, "personal", home.id]);

    // Not a Space they've joined, nor an anchor off their board: nothing moves.
    expect((await call("reorder_space", { space_id: hers.id, position: "start" })).error).toBe(
      `space not found: ${hers.id}`,
    );
    const offBoard = await call("reorder_space", { space_id: home.id, position: `after:${hers.id}` });
    expect(offBoard.error).toMatch(/anchor not found/);
    expect(listTrays(db, fred)).toEqual([work.id, "personal", home.id]);
  });

  it("returns not found for a list the caller can't see", async () => {
    const fred = createTestUser(db, { username: "fred" });
    const eve = createTestUser(db, { username: "eve" });
    const list = createProject(db, fred, { name: "Home" }, "web");

    const { error } = await (await connectAs(eve))("add_item", { list_id: list.id, title: "Sneaky" });
    expect(error).toBe(`list not found: ${list.id}`);
    expect(listItems(db, fred, list.id)).toHaveLength(0);
  });
});

describe("comments", () => {
  it("comments by ref as the agent, shows comments in get_item, and refuses a comment it can't add", async () => {
    const fred = createTestUser(db, { username: "fred" });
    const list = createProject(db, fred, { name: "Home" }, "web");
    const item = addItem(db, fred, { projectId: list.id, title: "Fix tap" }, "web");
    const call = await connectAs(fred);

    const added = await call("add_comment", { item_id: "HOM-1", body: "Ordered the washer" });
    expect(added.data).toMatchObject({
      itemId: item.id,
      body: "Ordered the washer",
      agentName: "Test agent",
      author: { userId: fred, displayUsername: "fred" },
    });

    const tooLong = await call("add_comment", { item_id: "HOM-1", body: "x".repeat(10_001) });
    expect(tooLong.error).toMatch(/^comment is too long .* — no change was made\.$/);

    const { data } = await call("get_item", { id: "HOM-1" });
    expect(data.comments).toEqual([
      expect.objectContaining({ body: "Ordered the washer", agentName: "Test agent" }),
    ]);
  });
});

describe("delete_label", () => {
  it("previews the items it's on, then deletes only with the token, as the agent", async () => {
    const fred = createTestUser(db, { username: "fred" });
    const eng = createProject(db, fred, { name: "Engineering" }, "web");
    const open = addItem(db, fred, { projectId: eng.id, title: "Fix login", labels: ["bug"] }, "web");
    const shut = addItem(db, fred, { projectId: eng.id, title: "Old crash", labels: ["bug"] }, "web");
    completeItem(db, fred, shut.id, "web");
    const bug = listLabels(db, fred, eng.id)[0];
    const call = await connectAs(fred);

    const preview = await call("delete_label", { id: bug.id });
    expect(preview.data).toMatchObject({
      deleted: false,
      label: { name: "bug" },
      usedOn: {
        active: [{ id: open.id, ref: "ENG-1", title: "Fix login" }],
        done: [{ id: shut.id, ref: "ENG-2", title: "Old crash" }],
      },
      token: expect.any(String),
    });
    const made = await call("delete_label", { id: bug.id, token: "x" });
    expect(made.error).toMatch(/changed.*no change was made/);
    expect(getItem(db, fred, open.id)?.labels).toEqual(["bug"]);

    const done = await call("delete_label", { id: bug.id, token: preview.data.token });
    expect(done.data).toMatchObject({ deleted: true });
    expect(getItem(db, fred, open.id)?.labels).toEqual([]);
    expect(listLabels(db, fred, eng.id)).toEqual([]);
    expect(
      listAudit(db, fred).filter((e) => e.entityId === bug.id && e.action === "delete"),
    ).toMatchObject([{ agentKeyId: AGENT.keyId }]);
  });
});

describe("move_item", () => {
  it("previews without changing anything, needs a labels choice, then moves as the agent", async () => {
    const fred = createTestUser(db, { username: "fred" });
    const eng = createProject(db, fred, { name: "Engineering" }, "web");
    const ops = createProject(db, fred, { name: "Ops" }, "web");
    addItem(db, fred, { projectId: ops.id, title: "Rotate keys", labels: ["Bug"] }, "web");
    const item = addItem(
      db,
      fred,
      { projectId: eng.id, title: "Fix login", labels: ["bug", "Frontend"], subItems: ["Repro"] },
      "web",
    );
    const call = await connectAs(fred);

    const preview = await call("move_item", { id: "ENG-1", list_id: ops.id });
    expect(preview.data).toEqual({
      moved: false,
      from: { id: eng.id, name: "Engineering" },
      to: { id: ops.id, name: "Ops" },
      refs: [
        { id: item.id, title: "Fix login", from: "ENG-1", to: "OPS-2" },
        expect.objectContaining({ title: "Repro", from: "ENG-2", to: "OPS-3" }),
      ],
      matchedLabels: [{ from: "bug", to: "Bug", itemIds: [item.id] }],
      missingLabels: [{ name: "Frontend", itemIds: [item.id] }],
      unassigned: [],
      token: expect.any(String),
    });
    expect(getItem(db, fred, item.id)?.projectId).toBe(eng.id);
    const { token } = preview.data;

    // A made-up token, or none with missing labels to decide, moves nothing.
    const made = await call("move_item", { id: "ENG-1", list_id: ops.id, token: "x", missing_labels: "drop" });
    expect(made.error).toMatch(/preview it again — no change was made/);
    const refused = await call("move_item", { id: "ENG-1", list_id: ops.id, token });
    expect(refused.error).toMatch(/Frontend.*no change was made/);
    expect(getItem(db, fred, item.id)?.projectId).toBe(eng.id);

    const done = await call("move_item", {
      id: "ENG-1",
      list_id: ops.id,
      token,
      missing_labels: { Frontend: "drop" },
    });
    expect(done.data).not.toHaveProperty("token");
    expect(done.data).toMatchObject({
      moved: true,
      item: { id: item.id, listId: ops.id, ref: "OPS-2", labels: ["Bug"] },
    });
    // The old ref still finds it.
    expect((await call("get_item", { id: "ENG-1" })).data).toMatchObject({ ref: "OPS-2" });
    const moves = listAudit(db, fred, { itemId: item.id })
      .filter((e) => e.entityId === item.id && e.detail.startsWith("moved"))
      .map((e) => [e.agentKeyId, e.projectId]);
    expect(moves.sort()).toEqual(
      [
        [AGENT.keyId, eng.id],
        [AGENT.keyId, ops.id],
      ].sort(),
    );
  });

  it("puts the item where position says among the list's top-level items, by ref", async () => {
    const fred = createTestUser(db, { username: "fred" });
    const eng = createProject(db, fred, { name: "Engineering" }, "web");
    const ops = createProject(db, fred, { name: "Ops" }, "web");
    addItem(db, fred, { projectId: ops.id, title: "Rotate keys", subItems: ["Find them"] }, "web");
    addItem(db, fred, { projectId: ops.id, title: "Patch hosts" }, "web");
    const item = addItem(db, fred, { projectId: eng.id, title: "Fix login" }, "web");
    const call = await connectAs(fred);

    // An anchor that isn't a top-level item there fails on the preview.
    for (const position of ["after:OPS-2", "after:ENG-1"]) {
      const bad = await call("move_item", { id: "ENG-1", list_id: ops.id, position });
      expect(bad.error).toMatch(/no change was made/);
    }
    const { data } = await call("move_item", { id: "ENG-1", list_id: ops.id, position: "after:OPS-1" });
    await call("move_item", { id: "ENG-1", list_id: ops.id, position: "after:OPS-1", token: data.token });
    expect(
      listItems(db, fred, ops.id)
        .filter((i) => !i.parentId)
        .map((i) => i.title),
    ).toEqual(["Rotate keys", "Fix login", "Patch hosts"]);
    expect(getItem(db, fred, item.id)?.projectId).toBe(ops.id);
  });

  it("returns not found for a list the caller can't see", async () => {
    const fred = createTestUser(db, { username: "fred" });
    const bob = createTestUser(db, { username: "bob" });
    const eng = createProject(db, fred, { name: "Engineering" }, "web");
    const bobs = createProject(db, bob, { name: "Bob's" }, "web");
    const item = addItem(db, fred, { projectId: eng.id, title: "Fix login" }, "web");
    const { error } = await (await connectAs(fred))("move_item", {
      id: "ENG-1",
      list_id: bobs.id,
      token: "x",
    });
    expect(error).toBe(`list not found: ${bobs.id}`);
    expect(getItem(db, fred, item.id)?.projectId).toBe(eng.id);
  });
});
