import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { listAudit } from "@/core/audit";
import { addItem, getItem, listItems } from "@/core/items";
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
