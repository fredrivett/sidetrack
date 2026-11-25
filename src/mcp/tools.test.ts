import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { listOpenAgentSessions } from "@/core/agentSessions";
import { setAgentWebhook } from "@/core/agentWebhooks";
import { createApiKey } from "@/core/api-keys";
import { listAudit } from "@/core/audit";
import { addComment, listComments } from "@/core/comments";
import { addItem, completeItem, getItem, listItems } from "@/core/items";
import { listLabels } from "@/core/labels";
import { acceptInvite, inviteMember } from "@/core/members";
import { createProject, getProject, listProjects, updateProject } from "@/core/projects";
import { addSmartMatch, setSmartRule } from "@/core/smartDue";
import {
  acceptSpaceInvite,
  createSpace,
  inviteSpaceMember,
  listPendingSpaceInvites,
  listTrays,
  setSpaceMemberRole,
} from "@/core/spaces";
import { sources } from "@/core/schema";
import { getSource, listPendingSources, receiveSourcePhoto } from "@/core/sources";
import { createTestDb, createTestUser } from "@/core/test-helpers";
import { setTimeZone } from "@/core/users";
import { getWrapUp } from "@/core/dayWrapUps";
import { dayWrapUps } from "@/core/schema";
import { dayOf } from "@/lib/time";
import { buildServer } from "./server";

// The tools run against a real in-memory DB through a real MCP client, as an
// agent would call them. Only the DB singleton and env are stubbed: no
// TYPESAFE_API_KEY, so add_item skips its AI duplicate check.
const ctx = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/core/db", () => ({ getDb: () => ({ db: ctx.db }) }));
const env = vi.hoisted(() => ({ values: {} as Record<string, unknown> }));
vi.mock("@/lib/env", () => ({ getEnv: () => env.values }));
// Agent webhooks are the network edge: record what would be sent instead.
const agentRequests = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/lib/agentRequest", () => ({ sendAgentRequest: agentRequests.send }));

type Db = ReturnType<typeof createTestDb>["db"];
let db: Db;

const AGENT = { keyId: "key-1", name: "Test agent" };

beforeEach(() => {
  env.values = {};
  agentRequests.send.mockReset().mockResolvedValue(undefined);
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
      days: [],
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

  it("sets a smart due date and its matches by ref, and an unknown match changes nothing", async () => {
    const fred = createTestUser(db, { username: "fred" });
    const list = createProject(db, fred, { name: "Home" }, "web");
    addItem(db, fred, { projectId: list.id, title: "Renew travel insurance" }, "web");
    addItem(db, fred, { projectId: list.id, title: "Lisbon", dueFrom: "2027-03-03", dueDate: "2027-03-08" }, "web");
    const call = await connectAs(fred);
    await call("set_smart_due", { id: "HOM-1", rule: "before our next trip", lead: 7 });
    expect((await call("add_smart_match", { id: "HOM-1", anchor_id: "HOM-9" })).error).toBeTruthy();
    const r = await call("add_smart_match", { id: "HOM-1", anchor_id: "HOM-2", reason: "a trip" });
    expect(r.data).toMatchObject({
      item: { ref: "HOM-1", dueDate: "2027-02-24", smartRule: "before our next trip" },
      smart: { lead: 7, matches: [{ ref: "HOM-2", reason: "a trip", current: true }] },
    });
    expect((await call("get_item", { id: "HOM-1" })).data.smart).toMatchObject({ rule: "before our next trip" });
    expect((await call("get_item", { id: "HOM-2" })).data).not.toHaveProperty("smart");
  });

  it("removes a match in a list the user can't open, by the id smart.matches gives", async () => {
    const fred = createTestUser(db, { username: "fred" });
    const ann = createTestUser(db, { username: "ann" });
    const home = createProject(db, fred, { name: "Home" }, "web");
    const secret = createProject(db, fred, { name: "Secret" }, "web");
    inviteMember(db, fred, home.id, "ann", "web");
    acceptInvite(db, ann, home.id, "web");
    const smart = addItem(db, fred, { projectId: home.id, title: "Bake a cake" }, "web");
    const party = addItem(db, fred, { projectId: secret.id, title: "Party", dueDate: "2027-03-03" }, "web");
    setSmartRule(db, fred, smart.id, { rule: "before the party", lead: 0 }, "web");
    addSmartMatch(db, fred, smart.id, party.id, null, "web");
    const call = await connectAs(ann);
    const r = await call("remove_smart_match", { id: "HOM-1", anchor_id: party.id });
    expect(r.data).toMatchObject({ item: { dueDate: null }, smart: { matches: [] } });
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
      expect(sent.data.emailed).toEqual([]);
      expect(sent.data.invited).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ list_id: list.id, userId: jo, role: "viewer", status: "pending" }),
          expect.objectContaining({ space_id: space.id, userId: jo, role: "commenter", status: "pending" }),
        ]),
      );
      expect(sent.data.invited).toHaveLength(4);
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

  it("emails a link to join to someone without an account, to the places or to nothing", async () => {
    const lorna = createTestUser(db, { username: "lorna" });
    const jo = createTestUser(db, { username: "jo" });
    const list = createProject(db, lorna, { name: "Life" }, "web");
    const call = await connectAs(lorna);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const mixed = await call("invite_people", { people: ["jo", "sam@example.com"], places: [{ list_id: list.id }] });
      expect(mixed.error).toBeNull();
      expect(mixed.data.invited).toEqual([expect.objectContaining({ list_id: list.id, userId: jo, status: "pending" })]);
      expect(mixed.data.emailed).toEqual([expect.objectContaining({ email: "sam@example.com", places: ["Life"] })]);

      const plain = await call("invite_people", { people: ["kim@example.com"] });
      expect(plain.data).toEqual({ invited: [], emailed: [expect.objectContaining({ email: "kim@example.com", places: [] })] });
      // Someone with an account needs somewhere to be invited to.
      expect((await call("invite_people", { people: ["jo"] })).error).toMatch(/on Sidetrack already/);
      expect(((await call("list_invitations")).data as unknown as { email: string }[]).map((i: { email: string }) => i.email).sort()).toEqual(["kim@example.com", "sam@example.com"]);
    } finally {
      log.mockRestore();
    }
  });
});

describe("invite_by_email", () => {
  it("shares the user's day with someone not on Sidetrack yet, emailing them their own link", async () => {
    const lorna = createTestUser(db, { username: "lorna", name: "Lorna" });
    const list = createProject(db, lorna, { name: "Life" }, "web");
    const space = createSpace(db, lorna, { name: "Home" }, "web");
    const call = await connectAs(lorna);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      // No place to share from: refused, and nothing is sent.
      const empty = await call("invite_by_email", { email: "jo@example.com", share_day: { within: "today" } });
      expect(empty.error).toMatch(/needs a list_id or space_id/);
      expect((await call("list_invitations")).data).toEqual([]);
      expect(log).not.toHaveBeenCalled();

      const sent = await call("invite_by_email", {
        email: "jo@example.com",
        share_day: { list_ids: [list.id], space_ids: [space.id], within: "week", mood: true },
      });
      expect(sent.data).toEqual(expect.objectContaining({ email: "jo@example.com", places: ["Life", "Home"], within: "week" }));
      const [invite] = (await call("list_invitations")).data as unknown as { id: string; places: unknown[]; mood: boolean; note: boolean }[];
      expect(invite).toMatchObject({ mood: true, note: false, places: [{ kind: "list", id: list.id }, { kind: "space", id: space.id }] });
      const link = (n: number) => /\/invite\/(\S+)/.exec(String(log.mock.calls[n]?.[0]))?.[1];
      expect(String(log.mock.calls[0][0])).toContain("jo@example.com: http://localhost:3000/invite/");

      // Sending it again emails a different link.
      expect((await call("resend_invitation", { id: invite.id })).error).toBeNull();
      expect(link(1)).toBeTruthy();
      expect(link(1)).not.toBe(link(0));

      expect((await call("cancel_invitation", { id: invite.id })).error).toBeNull();
      expect((await call("list_invitations")).data).toEqual([]);
    } finally {
      log.mockRestore();
    }
  });
});

describe("only_mine", () => {
  it("lets an agent share a list so someone sees only the user's items", async () => {
    const lorna = createTestUser(db, { username: "lorna" });
    const jo = createTestUser(db, { username: "jo" });
    const list = createProject(db, lorna, { name: "Week" }, "web");
    addItem(db, lorna, { projectId: list.id, title: "Swim", assigneeIds: [lorna] }, "web");
    addItem(db, lorna, { projectId: list.id, title: "Hidden" }, "web");
    const call = await connectAs(lorna);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const editor = await call("invite_member", { list_id: list.id, person: "jo", role: "editor", only_mine: true });
      expect(editor.error).toMatch(/viewers and commenters/);
      const sent = await call("invite_member", { list_id: list.id, person: "jo", role: "viewer", only_mine: true });
      expect(sent.data).toEqual(expect.objectContaining({ onlyAssignedTo: lorna }));
      acceptInvite(db, jo, list.id, "web");
      expect(listItems(db, jo, list.id).map((i) => i.title)).toEqual(["Swim"]);
      // Turned off, they see it all; left out, it stays as it was.
      await call("set_member_role", { list_id: list.id, user_id: jo, role: "commenter", only_mine: false });
      await call("set_member_role", { list_id: list.id, user_id: jo, role: "viewer" });
      expect(listItems(db, jo, list.id)).toHaveLength(2);
      // Only her today: Swim has no date, so it goes.
      expect((await call("set_member_role", { list_id: list.id, user_id: jo, role: "viewer", only_within: "today" })).error).toMatch(/just your items/);
      await call("set_member_role", { list_id: list.id, user_id: jo, role: "viewer", only_mine: true, only_within: "today" });
      expect(listItems(db, jo, list.id)).toEqual([]);
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

describe("comment edits and deletes", () => {
  it("edits and deletes the user's own comment, audited as the agent, and refuses anyone else's", async () => {
    const fred = createTestUser(db, { username: "fred" });
    const bob = createTestUser(db, { username: "bob" });
    const list = createProject(db, fred, { name: "Home" }, "web");
    inviteMember(db, fred, list.id, "bob", "web");
    acceptInvite(db, bob, list.id, "web");
    const item = addItem(db, fred, { projectId: list.id, title: "Fix tap" }, "web");
    const bobs = addComment(db, bob, item.id, "Bob's note", "web");
    const fredCall = await connectAs(fred);
    const mine = (await fredCall("add_comment", { item_id: "HOM-1", body: "Ordered the washr" })).data;

    const edited = await fredCall("update_comment", { id: mine.id, body: "Ordered the washer" });
    expect(edited.data).toMatchObject({ body: "Ordered the washer", editedAt: expect.any(Number) });

    for (const tool of ["update_comment", "delete_comment"]) {
      const { error } = await fredCall(tool, { id: bobs.id, body: "Hijacked" });
      expect(error).toMatch(/only a comment's author.*no change was made/);
    }
    expect(listComments(db, fred, item.id).map((c) => c.body)).toEqual([
      "Bob's note",
      "Ordered the washer",
    ]);

    expect((await fredCall("delete_comment", { id: mine.id })).data).toEqual({ deleted: true });
    expect(listComments(db, fred, item.id).map((c) => c.body)).toEqual(["Bob's note"]);
    // The deletion itself stays in the log, saying which agent did it.
    expect(listAudit(db, fred)[0]).toMatchObject({
      source: "mcp",
      agentKeyId: AGENT.keyId,
      agentName: AGENT.name,
      detail: 'deleted a comment on "Fix tap"',
    });

    const recent = await (await connectAs(bob))("list_recent_comments", { list_id: list.id });
    expect(recent.data).toEqual([
      expect.objectContaining({ body: "Bob's note", item: expect.objectContaining({ ref: "HOM-1" }) }),
    ]);
  });
});

describe("search_done, labels and notifications", () => {
  it("finds finished items across lists by title or ref, with their ref and list", async () => {
    const fred = createTestUser(db, { username: "fred" });
    const home = createProject(db, fred, { name: "Home" }, "web");
    const work = createProject(db, fred, { name: "Work" }, "web");
    const tap = addItem(db, fred, { projectId: home.id, title: "Fix tap" }, "web");
    addItem(db, fred, { projectId: home.id, title: "Fix fence" }, "web");
    const deck = addItem(db, fred, { projectId: work.id, title: "Fix the deck" }, "web");
    completeItem(db, fred, tap.id, "web");
    completeItem(db, fred, deck.id, "web");
    const call = await connectAs(fred);

    const fixes = (await call("search_done", { query: "fix" })).data.items as Record<string, unknown>[];
    // The open "Fix fence" isn't done, so it's left out.
    expect(fixes.map((it) => [it.ref, it.listName]).sort()).toEqual([
      ["HOM-1", "Home"],
      ["WOR-1", "Work"],
    ]);
    const byRef = (await call("search_done", { query: "wor-1" })).data.items as Record<string, unknown>[];
    expect(byRef.map((it) => it.title)).toEqual(["Fix the deck"]);
  });

  it("counts each label's open and done items only when asked", async () => {
    const fred = createTestUser(db, { username: "fred" });
    const list = createProject(db, fred, { name: "Home" }, "web");
    addItem(db, fred, { projectId: list.id, title: "A", labels: ["bug"] }, "web");
    const b = addItem(db, fred, { projectId: list.id, title: "B", labels: ["bug", "chore"] }, "web");
    completeItem(db, fred, b.id, "web");
    addItem(db, fred, { projectId: list.id, title: "C", labels: ["idea"] }, "web");
    const call = await connectAs(fred);

    const plain = (await call("list_labels", { list_id: list.id })).data as unknown as object[];
    expect(plain[0]).not.toHaveProperty("usage");
    const counted = (await call("list_labels", { list_id: list.id, include_usage: true }))
      .data as unknown as { name: string; usage: unknown }[];
    expect(Object.fromEntries(counted.map((l) => [l.name, l.usage]))).toEqual({
      bug: { active: 1, done: 1 },
      chore: { active: 0, done: 1 },
      idea: { active: 1, done: 0 },
    });
  });

  it("sets notification levels for scopes the user is in, and refuses others", async () => {
    const fred = createTestUser(db, { username: "fred" });
    const bob = createTestUser(db, { username: "bob" });
    const mine = createProject(db, fred, { name: "Home" }, "web");
    const bobs = createProject(db, bob, { name: "Secret" }, "web");
    const call = await connectAs(fred);

    const set = await call("set_notification_level", { scope: `list:${mine.id}`, level: "mine" });
    expect(set.data).toEqual({ levels: { [`list:${mine.id}`]: "mine" } });
    const refused = await call("set_notification_level", { scope: `list:${bobs.id}`, level: "all" });
    expect(refused.error).toMatch(/no change was made/);
    const cleared = await call("set_notification_level", { scope: `list:${mine.id}`, level: null });
    expect(cleared.data).toEqual({ levels: {} });
  });
});

// Reads the real changes/ and posts/ files, which only ever gain entries.
describe("list_changes", () => {
  type Changes = {
    entries: { date: string; text: string; prs: string[]; forSelfHosters?: boolean }[];
    posts: { date: string; title: string; body: string }[];
  };

  it("keeps entries and posts with every search word, from since on", async () => {
    const call = await connectAs(createTestUser(db));
    const changes = async (args: Record<string, unknown>) =>
      (await call("list_changes", args)).data as Changes;

    const pr = (n: number) => (e: Changes["entries"][number]) =>
      e.prs.includes(`https://github.com/fredrivett/sidetrack/pull/${n}`);
    const twoFactor = (await changes({ search: "AUTHENTICATOR backup" })).entries;
    expect(twoFactor.find(pr(367))).toMatchObject({
      date: "2026-11-20",
      text: expect.stringContaining("two-factor sign-in"),
    });
    expect(twoFactor.every((e) => /authenticator/i.test(e.text) && /backup/i.test(e.text))).toBe(true);
    expect((await changes({ search: "authenticator nosuchword" })).entries).toEqual([]);

    // since is inclusive, and narrows posts as well as entries.
    expect((await changes({ search: "authenticator", since: "2026-11-20" })).entries.some(pr(367))).toBe(true);
    const later = (await changes({ search: "authenticator", since: "2026-11-21" })).entries;
    expect(later.some(pr(367))).toBe(false);
    const recent = await changes({ since: "2026-11-22" });
    expect(recent.entries.every((e) => e.date >= "2026-11-22")).toBe(true);
    expect(recent.posts.map((p) => p.title)).toContain("Share your day, not your whole life");
    expect(recent.posts.map((p) => p.title)).not.toContain("A calmer place to start");

    const all = (await changes({})).entries;
    expect(all.find(pr(365))?.forSelfHosters).toBe(true);
    expect(all.find(pr(367))?.forSelfHosters).toBeUndefined();
  });
});

describe("feedback and collaborators", () => {
  it("files feedback under the user's name, saying which agent sent it, and adds to it once", async () => {
    const fred = createTestUser(db, { username: "fred" });
    const jane = createTestUser(db, { username: "jane" });
    const inbox = createProject(db, fred, { name: "Feedback" }, "web");
    const call = await connectAs(jane);

    const off = await call("send_feedback", { kind: "bug", message: "Board is blank" });
    expect(off.error).toMatch(/doesn't take feedback/);

    env.values = { FEEDBACK_LIST_ID: inbox.id };
    const sent = await call("send_feedback", { kind: "bug", message: "Board is blank\nAfter a reload" });
    expect(sent.data).toEqual({ itemId: expect.any(String), ref: "FEE-1" });
    const itemId = sent.data.itemId as string;
    const item = getItem(db, fred, itemId);
    expect(item).toMatchObject({ title: "Board is blank", labels: ["Bug", "Feedback"], createdBy: jane });
    expect(item?.description).toContain("From @jane · via Test agent");
    // Jane can add to it, but still can't open it.
    expect(getItem(db, jane, itemId)).toBeUndefined();

    const added = await call("add_to_feedback", { item_id: itemId, note: "Only on Safari" });
    expect(added.data).toEqual({ ok: true });
    expect(getItem(db, fred, itemId)?.description).toMatch(/\*\*Follow-up\*\*\n\nOnly on Safari\n\n---\nFrom @jane/);
    const again = await call("add_to_feedback", { item_id: itemId, note: "And Chrome" });
    expect(again.error).toMatch(/already added.*no change was made/);
  });

  it("lists who the user shares with, and with a place how each can open it", async () => {
    const fred = createTestUser(db, { username: "fred" });
    const ann = createTestUser(db, { username: "ann" });
    const samLee = createTestUser(db, { username: "samlee" });
    const samKing = createTestUser(db, { username: "samking" });
    createTestUser(db, { username: "pat" });
    const stranger = createTestUser(db, { username: "stranger" });
    const work = createSpace(db, fred, { name: "Work" }, "web");
    inviteSpaceMember(db, fred, work.id, "samlee", "web");
    acceptSpaceInvite(db, samLee, work.id, "web");
    const home = createProject(db, fred, { name: "Home", spaceId: work.id }, "web");
    inviteMember(db, fred, home.id, "ann", "web", "viewer");
    acceptInvite(db, ann, home.id, "web");
    inviteMember(db, fred, home.id, "pat", "web");
    const garden = createProject(db, fred, { name: "Garden" }, "web");
    inviteMember(db, fred, garden.id, "samking", "web");
    acceptInvite(db, samKing, garden.id, "web");
    const call = await connectAs(fred);
    const byName = (r: { data: unknown }) =>
      Object.fromEntries(
        ((r.data as { people: { username: string; access: unknown }[] }).people).map((p) => [p.username, p.access]),
      );

    // Everyone fred shares with; pat hasn't accepted, so isn't one yet.
    const everyone = (await call("list_collaborators")).data as unknown as { username: string }[];
    expect(everyone.map((p) => p.username)).toEqual(["ann", "samking", "samlee"]);

    // For Home: Sam Lee is in through Work, Sam King can't open it yet, and
    // pat's invite is still pending.
    const forHome = await call("list_collaborators", { list_id: home.id });
    expect(forHome.data.canInvite).toBe(true);
    expect(byName(forHome)).toEqual({
      ann: [{ via: "list", role: "viewer", pending: false }],
      pat: [{ via: "list", role: "editor", pending: true }],
      samking: [],
      samlee: [{ via: "space", role: "member", pending: false }],
    });
    expect(byName(await call("list_collaborators", { space_id: work.id }))).toMatchObject({
      ann: [],
      samlee: [{ via: "space", role: "member", pending: false }],
    });

    // ann can see who's on Home but can't invite; a stranger learns nothing.
    const asAnn = await (await connectAs(ann))("list_collaborators", { list_id: home.id });
    expect(asAnn.data.canInvite).toBe(false);
    expect(byName(asAnn).fred).toEqual([{ via: "list", role: "owner", pending: false }]);
    const asStranger = await (await connectAs(stranger))("list_collaborators", { list_id: home.id });
    expect(asStranger.error).toMatch(/not found/);
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

describe("assign_agent and unassign_agent", () => {
  // bob's Amp key, set to start work, and a Space list with a repository
  // that fred owns and bob is an admin of; lorna is a plain member.
  function seedSpace() {
    const fred = createTestUser(db, { username: "fred" });
    const bob = createTestUser(db, { username: "bob" });
    const lorna = createTestUser(db, { username: "lorna" });
    const space = createSpace(db, fred, { name: "Work" }, "web");
    for (const [who, name] of [[bob, "bob"], [lorna, "lorna"]] as const) {
      inviteSpaceMember(db, fred, space.id, name, "web");
      acceptSpaceInvite(db, who, space.id, "web");
    }
    setSpaceMemberRole(db, fred, space.id, bob, "admin", "web");
    const list = createProject(db, fred, { name: "Sidetrack", spaceId: space.id }, "web");
    updateProject(db, fred, list.id, { repository: "fredrivett/sidetrack" }, "web");
    const item = addItem(db, fred, { projectId: list.id, title: "Ship it" }, "web");
    const amp = createApiKey(db, bob, "Amp", "web").record.id;
    setAgentWebhook(db, bob, amp, "https://hooks.example.com/amp", "web");
    const lornas = createApiKey(db, lorna, "Lorna's Amp", "web").record.id;
    setAgentWebhook(db, lorna, lornas, "https://hooks.example.com/lorna", "web");
    return { bob, lorna, list, item, amp, lornas };
  }

  it("lets a Space admin start and stop their agent on its list, as the picker does", async () => {
    const { bob, list, item, amp } = seedSpace();
    const call = await connectAs(bob);
    expect((await call("list_agents")).data).toEqual({
      agents: [{ keyId: amp, name: "Amp" }],
      listIds: [list.id],
    });

    const assigned = await call("assign_agent", { item_id: "SID-1", agent_key_id: amp });
    expect(assigned.error).toBeNull();
    expect(assigned.data).toMatchObject({ itemId: item.id, agentKeyId: amp, finishedAt: null });
    expect(agentRequests.send).toHaveBeenLastCalledWith(
      expect.objectContaining({ body: expect.objectContaining({ type: "start", ref: "SID-1" }) }),
    );
    expect(listAudit(db, bob)[0]).toMatchObject({
      source: "mcp",
      agentKeyId: AGENT.keyId,
      detail: 'asked Amp to work on "Ship it"',
    });

    expect((await call("unassign_agent", { item_id: "SID-1", agent_key_id: amp })).data).toEqual({
      stopped: true,
    });
    expect(agentRequests.send).toHaveBeenLastCalledWith(
      expect.objectContaining({ body: expect.objectContaining({ type: "stop" }) }),
    );
    expect(listOpenAgentSessions(db, bob, item.id)).toEqual([]);
    expect((await call("unassign_agent", { item_id: "SID-1", agent_key_id: amp })).data).toEqual({
      stopped: false,
    });
  });

  it("refuses a member who isn't the list's admin, changing nothing", async () => {
    const { lorna, item, amp, lornas } = seedSpace();
    const call = await connectAs(lorna);
    expect((await call("list_agents")).data).toEqual({
      agents: [{ keyId: lornas, name: "Lorna's Amp" }],
      listIds: [],
    });
    for (const key of [lornas, amp]) {
      const { error } = await call("assign_agent", { item_id: "SID-1", agent_key_id: key });
      expect(error).toMatch(/only the list's admin.*no change was made/);
    }
    expect(agentRequests.send).not.toHaveBeenCalled();
    expect(listOpenAgentSessions(db, lorna, item.id)).toEqual([]);
  });

  it("takes the agent off again when its webhook can't be reached", async () => {
    const { bob, item, amp } = seedSpace();
    agentRequests.send.mockRejectedValueOnce(new Error("the agent's webhook answered 500"));
    const call = await connectAs(bob);
    const { error } = await call("assign_agent", { item_id: "SID-1", agent_key_id: amp });
    expect(error).toBe("the agent's webhook answered 500, so the agent wasn't started.");
    expect(listOpenAgentSessions(db, bob, item.id)).toEqual([]);
  });
});

describe("add_from_photo", () => {
  it("proposes lines against items found by ref, for review, with a one-time upload URL", async () => {
    const fred = createTestUser(db, { username: "fred" });
    const life = createProject(db, fred, { name: "Life" }, "web");
    const plan = addItem(db, fred, { projectId: life.id, title: "Change phone plan" }, "web");
    const call = await connectAs(fred);
    const { data: planOut } = await call("get_item", { id: plan.id });
    const auditBefore = listAudit(db, fred, { limit: 500 }).length;

    const { error, data } = await call("add_from_photo", {
      lines: [
        { title: "Change phone plan", list_id: life.id, match: planOut.ref, done: true },
        { title: "Lorna's SIM", list_id: life.id, parent_item: planOut.ref },
        { title: "Tidy up flat", list_id: life.id, region: { x: 0.1, y: 0.2, w: 0.5, h: 0.05 } },
        { title: "Hoover", list_id: life.id, parent: 2 },
      ],
    });
    expect(error).toBeNull();
    const id = data.source_id as string;
    expect(data.review_url).toBe(`http://localhost:3000/sources/${id}`);
    expect((data.upload as { url: string }).url).toMatch(
      /^http:\/\/localhost:3000\/api\/sources\/upload\/[\w-]{20,}$/,
    );
    const source = getSource(db, fred, id);
    expect(source?.agentName).toBe(AGENT.name);
    expect(source?.lines.map((l) => [l.title, l.matchItemId, l.parentItemId, l.done])).toEqual([
      ["Change phone plan", plan.id, null, true],
      ["Lorna's SIM", null, plan.id, false],
      ["Tidy up flat", null, null, false],
      ["Hoover", null, null, false],
    ]);
    expect(source?.lines[3].parentLineId).toBe(source?.lines[2].id);
    // A proposal changes nothing on the board, so it isn't in the log yet.
    expect(listItems(db, fred, life.id)).toHaveLength(1);
    expect(listAudit(db, fred, { limit: 500 })).toHaveLength(auditBefore);
  });

  it("saves nothing when one line is wrong, and says which", async () => {
    const fred = createTestUser(db, { username: "fred" });
    const life = createProject(db, fred, { name: "Life" }, "web");
    const call = await connectAs(fred);

    const bad = await call("add_from_photo", {
      lines: [
        { title: "Tidy up flat", list_id: life.id },
        { title: "Hoover", list_id: life.id, parent: 5 },
      ],
    });
    expect(bad.error).toMatch(/line 1: parent must be the index of an earlier line.*nothing was saved/);
    const unknown = await call("add_from_photo", {
      lines: [{ title: "Order coffee", list_id: life.id, match: "LIF-99" }],
    });
    expect(unknown.error).not.toBeNull();
    expect(listPendingSources(db, fred)).toEqual([]);
    expect(db.select().from(sources).all()).toEqual([]);
  });

  it("adds the lines when the user says so, linking each item to the photo, or discards them", async () => {
    const fred = createTestUser(db, { username: "fred" });
    const life = createProject(db, fred, { name: "Life" }, "web");
    const call = await connectAs(fred);
    const propose = async (title: string) => {
      const { data } = await call("add_from_photo", { lines: [{ title, list_id: life.id }] });
      return data as { source_id: string; upload: { url: string } };
    };
    const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

    const kept = await propose("Plant jasmine");
    // Not before the photo is there to link to.
    expect((await call("add_photo_lines", { source_id: kept.source_id })).error).toMatch(/hasn't been uploaded/);
    receiveSourcePhoto(db, kept.upload.url.split("/").at(-1) ?? "", PNG);
    expect((await call("add_photo_lines", { source_id: kept.source_id })).data).toEqual({
      added: 1,
      updated: 0,
      completed: 0,
      skipped: 0,
    });
    const [item] = listItems(db, fred, life.id);
    expect(item.title).toBe("Plant jasmine");
    expect((await call("get_item", { id: item.id })).data.fromPhoto).toMatchObject({ source_id: kept.source_id });
    expect(listAudit(db, fred)[0]).toMatchObject({ source: "mcp", agentKeyId: AGENT.keyId });
    expect((await call("add_photo_lines", { source_id: kept.source_id })).error).toMatch(/already been added/);
    expect((await call("discard_photo", { source_id: kept.source_id })).data).toEqual({ discarded: false });

    const dropped = await propose("Descale kettle");
    expect((await call("discard_photo", { source_id: dropped.source_id })).data).toEqual({ discarded: true });
    expect(getSource(db, fred, dropped.source_id)).toBeNull();
    expect(listItems(db, fred, life.id)).toHaveLength(1);
  });
});

describe("close_day", () => {
  it("closes the user's today with their moods and words, and refuses without a timezone", async () => {
    const fred = createTestUser(db, { username: "fred" });
    const call = await connectAs(fred);
    expect((await call("close_day", { mood: ["Tired"], words: "long one" })).error).toMatch(/Nothing was changed/);
    expect(db.select().from(dayWrapUps).all()).toEqual([]);
    setTimeZone(db, fred, "Europe/London");
    const { data } = await call("close_day", { mood: ["Tired", "Good day"], words: " long one " });
    // Moods come back in their usual order, however they were given.
    expect(data).toMatchObject({ day: dayOf(Date.now(), "Europe/London"), mood: ["Good day", "Tired"], words: "long one" });
    expect(getWrapUp(db, fred, data.day as string)?.text).toBe("Good day, Tired — long one");
    expect((await call("close_day", { mood: ["Busy"] })).error).not.toBeNull();
  });
});

describe("Someday", () => {
  it("sends an item to Someday by its ref, off the No date list", async () => {
    const fred = createTestUser(db, { username: "fred" });
    const list = createProject(db, fred, { name: "Home" }, "web");
    addItem(db, fred, { projectId: list.id, title: "Redo the garden", dueDate: "2026-12-01" }, "web");
    addItem(db, fred, { projectId: list.id, title: "Tidy flat" }, "web");
    const call = await connectAs(fred);

    const { data } = await call("update_item", { id: "HOM-1", someday: true });
    expect(data.updated).toMatchObject({ ref: "HOM-1", dueDate: null, somedayAt: expect.any(Number) });
    const noDate = await call("list_no_date");
    const titles = (noDate.data.lists as { items: { title: string }[] }[]).flatMap((l) => l.items.map((i) => i.title));
    expect(titles).toEqual(["Tidy flat"]);
    expect((await call("update_item", { id: "HOM-1", someday: true, due_date: "2026-12-01" })).error).toMatch(/Someday/);
  });
});
