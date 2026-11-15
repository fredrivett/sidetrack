import { describe, expect, it } from "vitest";
import {
  type AgentOrigin,
  finishWork,
  listAllAgentSessions,
  reportWork,
  startWork,
} from "./agentSessions";
import { listAudit } from "./audit";
import { addItem, completeItem, getItem } from "./items";
import { acceptInvite, inviteMember } from "./members";
import { createProject } from "./projects";
import { createTestDb, createTestUser } from "./test-helpers";

const AMP: AgentOrigin = { source: "mcp", agent: { keyId: "key-amp", name: "Amp" } };
const CLAUDE: AgentOrigin = { source: "mcp", agent: { keyId: "key-cc", name: "Claude" } };
const THREAD = "https://ampcode.com/threads/T-1";

function seed() {
  const { db } = createTestDb();
  const userId = createTestUser(db, { username: "fred" });
  const p = createProject(db, userId, { name: "Sidetrack" }, "web");
  const item = addItem(db, userId, { projectId: p.id, title: "Ship it" }, "web");
  return { db, userId, projectId: p.id, itemId: item.id };
}

describe("startWork", () => {
  it("opens a session for the agent, assigns the key's owner, and audits it", () => {
    const { db, userId, itemId } = seed();
    const session = startWork(db, userId, itemId, { threadUrl: THREAD }, AMP);

    expect(session).toMatchObject({
      itemId,
      userId,
      agentKeyId: "key-amp",
      agentName: "Amp",
      threadUrl: THREAD,
      branch: "sid-1-ship-it",
      finishedAt: null,
    });
    expect(getItem(db, userId, itemId)?.assigneeIds).toEqual([userId]);
    const [row] = listAudit(db, userId);
    expect(row).toMatchObject({
      source: "mcp",
      action: "start",
      entityType: "item",
      entityId: itemId,
      agentKeyId: "key-amp",
      agentName: "Amp",
      detail: 'started work on "Ship it", assigned to @fred',
    });
  });

  it("leaves an item's existing assignees alone", () => {
    const { db, userId, projectId } = seed();
    const lorna = createTestUser(db, { username: "lorna" });
    inviteMember(db, userId, projectId, "lorna", "web");
    acceptInvite(db, lorna, projectId, "web");
    const item = addItem(
      db,
      userId,
      { projectId, title: "Hers", assigneeIds: [lorna] },
      "web",
    );

    startWork(db, userId, item.id, {}, AMP);

    expect(getItem(db, userId, item.id)?.assigneeIds).toEqual([lorna]);
    expect(listAudit(db, userId)[0].detail).toBe('started work on "Hers"');
  });

  it("resumes the agent's open session instead of opening another", () => {
    const { db, userId, itemId } = seed();
    const first = startWork(db, userId, itemId, {}, AMP);
    const again = startWork(db, userId, itemId, { threadUrl: THREAD }, AMP);

    expect(again.id).toBe(first.id);
    expect(again.threadUrl).toBe(THREAD);
    expect(listAllAgentSessions(db, userId)).toHaveLength(1);
    expect(listAudit(db, userId)[0].detail).toBe('resumed work on "Ship it"');
  });

  it("gives each agent its own session on the same item", () => {
    const { db, userId, itemId } = seed();
    startWork(db, userId, itemId, {}, AMP);
    startWork(db, userId, itemId, {}, CLAUDE);

    expect(listAllAgentSessions(db, userId).map((s) => s.agentName)).toEqual([
      "Amp",
      "Claude",
    ]);
  });

  it("rejects a non-web thread URL and a completed item, writing nothing", () => {
    const { db, userId, itemId } = seed();
    expect(() =>
      startWork(db, userId, itemId, { threadUrl: "javascript:alert(1)" }, AMP),
    ).toThrow();
    completeItem(db, userId, itemId, "web");
    expect(() => startWork(db, userId, itemId, {}, AMP)).toThrow(/completed/);

    expect(listAllAgentSessions(db, userId)).toEqual([]);
    expect(listAudit(db, userId).some((e) => e.action === "start")).toBe(false);
  });

  it("can't reach an item in someone else's list", () => {
    const { db, itemId } = seed();
    const stranger = createTestUser(db);
    expect(() => startWork(db, stranger, itemId, {}, AMP)).toThrow(/not found/);
  });
});

describe("reportWork", () => {
  it("records the note, marks the agent active, and audits it", () => {
    const { db, userId, itemId } = seed();
    const started = startWork(db, userId, itemId, {}, AMP);
    const reported = reportWork(db, userId, itemId, "  Opened the PR,\n waiting on CI ", AMP);

    expect(reported.note).toBe("Opened the PR, waiting on CI");
    expect(reported.lastActiveAt).toBeGreaterThanOrEqual(started.lastActiveAt);
    expect(listAllAgentSessions(db, userId)[0].note).toBe("Opened the PR, waiting on CI");
    expect(listAudit(db, userId)[0]).toMatchObject({
      action: "report",
      agentName: "Amp",
      detail: 'reported on "Ship it": Opened the PR, waiting on CI',
    });
  });

  it("counts an emoji as one character against the 280 limit", () => {
    const { db, userId, itemId } = seed();
    startWork(db, userId, itemId, {}, AMP);
    // 280 emoji are 560 UTF-16 units but 280 characters.
    expect(reportWork(db, userId, itemId, "🚀".repeat(280), AMP).note).toHaveLength(560);
    expect(() => reportWork(db, userId, itemId, "🚀".repeat(281), AMP)).toThrow(/281/);
  });

  it("refuses an agent with no open session, writing nothing", () => {
    const { db, userId, itemId } = seed();
    startWork(db, userId, itemId, {}, AMP);
    const before = listAudit(db, userId).length;

    expect(() => reportWork(db, userId, itemId, "hi", CLAUDE)).toThrow(/start_work/);
    expect(listAudit(db, userId)).toHaveLength(before);
  });
});

describe("finishWork", () => {
  it("closes the session; a later start opens a new one", () => {
    const { db, userId, itemId } = seed();
    const first = startWork(db, userId, itemId, {}, AMP);
    const done = finishWork(db, userId, itemId, { note: "PR merged" }, AMP);

    expect(done?.finishedAt).not.toBeNull();
    expect(done?.note).toBe("PR merged");
    expect(listAudit(db, userId)[0]).toMatchObject({
      action: "finish",
      detail: 'finished work on "Ship it": PR merged',
    });
    // The item itself is left as it was.
    expect(getItem(db, userId, itemId)?.completedAt).toBeNull();

    const second = startWork(db, userId, itemId, {}, AMP);
    expect(second.id).not.toBe(first.id);
  });

  it("treats a blank note as none and still closes the session", () => {
    const { db, userId, itemId } = seed();
    startWork(db, userId, itemId, {}, AMP);
    const done = finishWork(db, userId, itemId, { note: "   " }, AMP);
    expect(done?.finishedAt).not.toBeNull();
    expect(listAudit(db, userId)[0].detail).toBe('finished work on "Ship it"');
  });

  it("is a no-op without an open session", () => {
    const { db, userId, itemId } = seed();
    const before = listAudit(db, userId).length;
    expect(finishWork(db, userId, itemId, {}, AMP)).toBeNull();
    expect(listAudit(db, userId)).toHaveLength(before);
  });
});

describe("listAllAgentSessions", () => {
  it("returns open sessions plus only each item's latest finished one", () => {
    const { db, userId, itemId } = seed();
    startWork(db, userId, itemId, {}, AMP);
    finishWork(db, userId, itemId, { note: "first" }, AMP);
    startWork(db, userId, itemId, {}, AMP);
    finishWork(db, userId, itemId, { note: "second" }, AMP);
    startWork(db, userId, itemId, {}, CLAUDE);

    const sessions = listAllAgentSessions(db, userId);
    expect(sessions.map((s) => [s.agentName, s.note])).toEqual([
      ["Amp", "second"],
      ["Claude", null],
    ]);
  });
});

describe("completing an item", () => {
  it("ends every open session on it and on its sub-items", () => {
    const { db, userId, projectId, itemId } = seed();
    const child = addItem(db, userId, { projectId, title: "Step", parentId: itemId }, "web");
    startWork(db, userId, itemId, {}, AMP);
    startWork(db, userId, child.id, {}, CLAUDE);

    completeItem(db, userId, itemId, "web");

    const sessions = listAllAgentSessions(db, userId);
    expect(sessions.map((s) => s.itemId).sort()).toEqual([itemId, child.id].sort());
    expect(sessions.map((s) => s.finishedAt)).not.toContain(null);
  });
});
