import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { listAudit } from "./audit";
import {
  addComment,
  deleteComment,
  listComments,
  listRecentComments,
  mentionNotice,
  updateComment,
} from "./comments";
import { addItem, deleteItem } from "./items";
import { acceptInvite, inviteMember } from "./members";
import { createProject, getProject } from "./projects";
import { comments } from "./schema";
import { createTestDb, createTestUser } from "./test-helpers";

const AMP = { source: "mcp" as const, agent: { keyId: "key-amp", name: "Amp" } };

function seed() {
  const { db } = createTestDb();
  const owner = createTestUser(db, { username: "fred", name: "Fred" });
  const alice = createTestUser(db, { username: "alice", name: "Alice" });
  const p = createProject(db, owner, { name: "Home" }, "web");
  const item = addItem(db, owner, { projectId: p.id, title: "Fix tap" }, "web");
  return { db, owner, alice, projectId: p.id, itemId: item.id };
}

describe("comments", () => {
  it("adds a comment with its author, oldest first, and audits it under the item", () => {
    const { db, owner, projectId, itemId } = seed();
    // In the same millisecond, so the order can't come from the timestamps.
    const now = vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    const first = addComment(db, owner, itemId, "  Washer is worn  ", "web");
    const second = addComment(db, owner, itemId, "Bought a new one", AMP);
    const third = addComment(db, owner, itemId, "Fitted it", "web");
    now.mockRestore();

    expect(first).toMatchObject({ body: "Washer is worn", agentName: null });
    expect(first.author).toMatchObject({ userId: owner, name: "Fred", displayUsername: "fred" });
    expect(second).toMatchObject({ agentKeyId: "key-amp", agentName: "Amp" });
    expect(listComments(db, owner, itemId).map((c) => c.id)).toEqual([
      first.id,
      second.id,
      third.id,
    ]);

    const rows = listAudit(db, owner, { itemId });
    expect(rows.find((r) => r.entityId === second.id)).toMatchObject({
      action: "create",
      entityType: "comment",
      source: "mcp",
      agentName: "Amp",
      projectId,
      parentId: itemId,
    });
  });

  it("rejects empty and over-long comments without writing anything", () => {
    const { db, owner, itemId } = seed();
    expect(() => addComment(db, owner, itemId, "   ", "web")).toThrow(/empty/);
    expect(() => addComment(db, owner, itemId, "x".repeat(10_001), "web")).toThrow(/too long/);
    expect(listComments(db, owner, itemId)).toEqual([]);
    expect(listAudit(db, owner, { itemId }).some((r) => r.entityType === "comment")).toBe(false);
  });

  it("is open to members and closed to everyone else", () => {
    const { db, owner, alice, projectId, itemId } = seed();
    expect(() => addComment(db, alice, itemId, "Hi", "web")).toThrow(/not found/);
    addComment(db, owner, itemId, "Private until shared", "web");
    expect(listComments(db, alice, itemId)).toEqual([]);

    inviteMember(db, owner, projectId, "alice", "web");
    acceptInvite(db, alice, projectId, "web");
    expect(listComments(db, alice, itemId)).toHaveLength(1);
    expect(addComment(db, alice, itemId, "On it", "web").author?.name).toBe("Alice");
  });

  it("lets only the author edit or delete, and audits only real changes", () => {
    const { db, owner, alice, projectId, itemId } = seed();
    inviteMember(db, owner, projectId, "alice", "web");
    acceptInvite(db, alice, projectId, "web");
    const c = addComment(db, owner, itemId, "Draft", "web");

    expect(() => updateComment(db, alice, c.id, "Hijacked", "web")).toThrow(/author/);
    expect(() => deleteComment(db, alice, c.id, "web")).toThrow(/author/);

    const same = updateComment(db, owner, c.id, " Draft ", "web");
    expect(same.editedAt).toBeNull();
    const edited = updateComment(db, owner, c.id, "Final", "web");
    expect(edited).toMatchObject({ body: "Final" });
    expect(edited.editedAt).not.toBeNull();

    deleteComment(db, owner, c.id, "web");
    expect(listComments(db, owner, itemId)).toEqual([]);
    const actions = listAudit(db, owner, { itemId })
      .filter((r) => r.entityId === c.id)
      .map((r) => r.action);
    expect(actions.sort()).toEqual(["create", "delete", "update"]);
  });

  it("goes with its item, and doesn't show in another item's history", () => {
    const { db, owner, projectId, itemId } = seed();
    const other = addItem(db, owner, { projectId, title: "Paint fence" }, "web");
    addComment(db, owner, itemId, "Note", "web");
    expect(listAudit(db, owner, { itemId: other.id }).some((r) => r.entityType === "comment")).toBe(
      false,
    );
    deleteItem(db, owner, itemId, "web");
    expect(db.select().from(comments).where(eq(comments.itemId, itemId)).all()).toEqual([]);
  });

  it("feeds the newest comments the user can see, across lists or in one", () => {
    const { db, owner, alice, projectId, itemId } = seed();
    const garden = createProject(db, owner, { name: "Garden" }, "web");
    const hedge = addItem(db, owner, { projectId: garden.id, title: "Trim hedge" }, "web");
    const alicesList = createProject(db, alice, { name: "Alice's" }, "web");
    const hers = addItem(db, alice, { projectId: alicesList.id, title: "Hers" }, "web");

    const now = vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    const tap = addComment(db, owner, itemId, "Washer is worn", "web");
    const hedgeNote = addComment(db, owner, hedge.id, "Wait for spring", "web");
    addComment(db, alice, hers.id, "Not yours", "web");
    now.mockReturnValue(1_800_000_000_001);
    const fitted = addComment(db, owner, itemId, "Fitted it", AMP);
    now.mockRestore();

    const all = listRecentComments(db, owner);
    expect(all.map((c) => c.id)).toEqual([fitted.id, hedgeNote.id, tap.id]);
    expect(all[0]).toMatchObject({
      body: "Fitted it",
      agentName: "Amp",
      item: { id: itemId, title: "Fix tap", number: 1, projectId },
    });

    expect(listRecentComments(db, owner, { projectId: garden.id }).map((c) => c.id)).toEqual([
      hedgeNote.id,
    ]);
    expect(listRecentComments(db, owner, { limit: 2 }).map((c) => c.id)).toEqual([
      fitted.id,
      hedgeNote.id,
    ]);
    // Not a list the user can open.
    expect(listRecentComments(db, owner, { projectId: alicesList.id })).toEqual([]);

    // A member's feed has the shared list's comments with their own, and
    // still not the lists that aren't shared with them.
    inviteMember(db, owner, projectId, "alice", "web");
    acceptInvite(db, alice, projectId, "web");
    expect(listRecentComments(db, alice).map((c) => c.item.title)).toEqual([
      "Fix tap",
      "Hers",
      "Fix tap",
    ]);
  });

  it("notifies the people a comment mentions who can open its item", () => {
    const { db, owner, alice, projectId, itemId } = seed();
    inviteMember(db, owner, projectId, "alice", "web");
    acceptInvite(db, alice, projectId, "web");
    // Bob has an account but can't open the item, so mentioning him tells no one.
    const bob = createTestUser(db, { username: "bob", name: "Bob" });

    const comment = addComment(
      db,
      owner,
      itemId,
      "@Alice. can you check? cc @bob, me@fred `@fred` @fred",
      "web",
    );
    const notice = mentionNotice(db, owner, comment);
    const prefix = getProject(db, owner, projectId)?.prefix;
    // Fred mentioning himself isn't news; neither is an email address or code.
    expect(notice).toMatchObject({
      authorName: "Fred",
      itemRef: `${prefix}-1`,
      itemTitle: "Fix tap",
      body: comment.body,
    });
    expect(notice?.to.map((t) => t.userId)).toEqual([alice]);
    expect(mentionNotice(db, bob, comment)).toBeNull();
  });

  it("tells an edit's newly mentioned people only, and the user when an agent asks", () => {
    const { db, owner, alice, projectId, itemId } = seed();
    inviteMember(db, owner, projectId, "alice", "web");
    acceptInvite(db, alice, projectId, "web");

    const first = addComment(db, alice, itemId, "Over to @fred", "web");
    expect(mentionNotice(db, alice, first)?.to.map((t) => t.userId)).toEqual([owner]);
    // Fred already heard; Alice adding herself isn't news.
    const edited = updateComment(db, alice, first.id, "Over to @fred and @alice", "web");
    expect(mentionNotice(db, alice, edited, first.body)).toBeNull();

    // An agent mentioning the user it acts for is how it asks for their answer.
    const asked = addComment(db, owner, itemId, "@fred which washer size?", AMP);
    expect(mentionNotice(db, owner, asked)).toMatchObject({
      authorName: "Amp (for Fred)",
      to: [{ userId: owner }],
    });
  });
});
