import { describe, expect, it } from "vitest";
import {
  type AgentOrigin,
  finishWork,
  listAllAgentSessions,
  reportWork,
  endAgentSession,
  listStartableLists,
  requestWork,
  startWork,
  stopRequest,
} from "./agentSessions";
import { removeAgentWebhook, setAgentWebhook } from "./agentWebhooks";
import { createApiKey, revokeApiKey } from "./api-keys";
import { listAudit } from "./audit";
import { addItem, completeItem, getItem } from "./items";
import { acceptInvite, inviteMember } from "./members";
import { createProject, updateProject } from "./projects";
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
    const { db, userId, projectId, itemId } = seed();
    const other = addItem(db, userId, { projectId, title: "Other" }, "web");
    for (const [id, notes] of [
      [itemId, ["a1", "a2"]],
      [other.id, ["b1", "b2", "b3"]],
    ] as const) {
      for (const note of notes) {
        startWork(db, userId, id, {}, AMP);
        finishWork(db, userId, id, { note }, AMP);
      }
    }
    startWork(db, userId, itemId, {}, CLAUDE);

    const sessions = listAllAgentSessions(db, userId);
    expect(sessions.map((s) => [s.itemId, s.agentName, s.note]).sort()).toEqual(
      [
        [itemId, "Amp", "a2"],
        [itemId, "Claude", null],
        [other.id, "Amp", "b3"],
      ].sort(),
    );
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

describe("requestWork and stopWork", () => {
  // fred's Amp key, set to start work, on a list with a repository.
  function seedAgent() {
    const s = seed();
    const { record } = createApiKey(s.db, s.userId, "Amp", "web");
    setAgentWebhook(s.db, s.userId, record.id, "https://hooks.example.com/amp", "web");
    updateProject(s.db, s.userId, s.projectId, { repository: "fredrivett/sidetrack" }, "web");
    return { ...s, keyId: record.id };
  }

  it("opens a starting session and returns a start request, which start_work then resumes", () => {
    const { db, userId, itemId, keyId } = seedAgent();
    const { session, request } = requestWork(db, userId, itemId, keyId, "web");

    expect(session).toMatchObject({ agentKeyId: keyId, agentName: "Amp", threadUrl: null });
    expect(request).toEqual({
      url: "https://hooks.example.com/amp",
      secret: expect.stringMatching(/^[0-9a-f]{64}$/),
      idempotencyKey: session.id,
      body: {
        type: "start",
        sessionId: session.id,
        itemId,
        ref: "SID-1",
        repository: "fredrivett/sidetrack",
      },
    });
    // People's assignments are left alone; the agent shows by its session.
    expect(getItem(db, userId, itemId)?.assigneeIds).toEqual([]);
    expect(listAudit(db, userId)[0]).toMatchObject({
      source: "web",
      action: "start",
      detail: 'asked Amp to work on "Ship it"',
    });

    // Assigning it again changes nothing and sends nothing.
    const logged = listAudit(db, userId).length;
    expect(requestWork(db, userId, itemId, keyId, "web")).toEqual({ session, request: null });
    expect(listAudit(db, userId).length).toBe(logged);

    // The started thread calls start_work with the same key: same session.
    const agent: AgentOrigin = { source: "mcp", agent: { keyId, name: "Amp" } };
    const resumed = startWork(db, userId, itemId, { threadUrl: THREAD }, agent);
    expect(resumed).toMatchObject({ id: session.id, threadUrl: THREAD });
  });

  it("stops by telling the agent first, then ending the session by its id", () => {
    const { db, userId, itemId, keyId } = seedAgent();
    const { session } = requestWork(db, userId, itemId, keyId, "web");

    // Reading the stop request changes nothing, so a failed delivery can be retried.
    const found = stopRequest(db, userId, itemId, keyId);
    expect(found?.request).toMatchObject({
      idempotencyKey: `${session.id}:stop`,
      body: { type: "stop", sessionId: session.id, itemId, ref: "SID-1" },
    });
    expect(stopRequest(db, userId, itemId, keyId)?.session.id).toBe(session.id);
    expect(listAllAgentSessions(db, userId)[0].finishedAt).toBeNull();

    expect(endAgentSession(db, userId, session.id, "web")).toBe(true);
    expect(listAllAgentSessions(db, userId)).toEqual([
      expect.objectContaining({ id: session.id, finishedAt: expect.any(Number) }),
    ]);
    expect(listAudit(db, userId)[0]).toMatchObject({
      action: "finish",
      detail: 'stopped Amp on "Ship it"',
    });
    const agent: AgentOrigin = { source: "mcp", agent: { keyId, name: "Amp" } };
    expect(() => reportWork(db, userId, itemId, "Still going", agent)).toThrow(/no open work session/);
    // Nothing left to stop, and ending it again writes nothing.
    expect(stopRequest(db, userId, itemId, keyId)).toBeUndefined();
    const logged = listAudit(db, userId).length;
    expect(endAgentSession(db, userId, session.id, "web")).toBe(false);
    expect(listAudit(db, userId).length).toBe(logged);
  });

  it("rolls back only the session it opened, not a newer one", () => {
    const { db, userId, itemId, keyId } = seedAgent();
    const first = requestWork(db, userId, itemId, keyId, "web").session;
    endAgentSession(db, userId, first.id, "web");
    const second = requestWork(db, userId, itemId, keyId, "web").session;

    // A late rollback of the first start leaves the second running.
    expect(endAgentSession(db, userId, first.id, "web", "webhook answered 500")).toBe(false);
    expect(stopRequest(db, userId, itemId, keyId)?.session.id).toBe(second.id);
  });

  it("refuses a member who isn't the list's admin, and lists without a repository", () => {
    const { db, userId, projectId, itemId, keyId } = seedAgent();
    const lorna = createTestUser(db, { username: "lorna" });
    inviteMember(db, userId, projectId, "lorna", "web");
    acceptInvite(db, lorna, projectId, "web");
    const { record } = createApiKey(db, lorna, "Lorna's Amp", "web");
    setAgentWebhook(db, lorna, record.id, "https://hooks.example.com/lorna", "web");

    expect(() => requestWork(db, lorna, itemId, record.id, "web")).toThrow(/only the list's admin/);
    // Nor can anyone start someone else's agent.
    expect(() => requestWork(db, lorna, itemId, keyId, "web")).toThrow(/only the list's admin/);
    expect(() => requestWork(db, userId, itemId, record.id, "web")).toThrow(/agent not found/);

    updateProject(db, userId, projectId, { repository: null }, "web");
    expect(() => requestWork(db, userId, itemId, keyId, "web")).toThrow(/no repository/);
    completeItem(db, userId, itemId, "web");
    updateProject(db, userId, projectId, { repository: "fredrivett/sidetrack" }, "web");
    expect(() => requestWork(db, userId, itemId, keyId, "web")).toThrow(/completed/);
    expect(listAllAgentSessions(db, userId)).toEqual([]);
  });

  it("refuses a key that isn't set to start work, but still stops one whose webhook or key went", () => {
    const { db, userId, itemId, keyId } = seedAgent();
    const { record } = createApiKey(db, userId, "Claude", "web");
    expect(() => requestWork(db, userId, itemId, record.id, "web")).toThrow(/isn't set to start/);

    requestWork(db, userId, itemId, keyId, "web");
    removeAgentWebhook(db, userId, keyId, "web");
    // No webhook left to tell, so there's no request; the session still ends.
    const found = stopRequest(db, userId, itemId, keyId);
    expect(found?.request).toBeNull();
    const sessionId = found?.session.id ?? "";

    revokeApiKey(db, userId, keyId, "web");
    // Revoking the key doesn't strand its session either.
    expect(stopRequest(db, userId, itemId, keyId)?.session.id).toBe(sessionId);
    expect(endAgentSession(db, userId, sessionId, "web")).toBe(true);
  });

  it("lists the lists the user can start agents on: theirs to admin, with a repository", () => {
    const { db, userId, projectId } = seedAgent();
    const bare = createProject(db, userId, { name: "No repo" }, "web");
    const lorna = createTestUser(db, { username: "lorna" });
    inviteMember(db, userId, projectId, "lorna", "web");
    acceptInvite(db, lorna, projectId, "web");

    expect(listStartableLists(db, userId)).toEqual([projectId]);
    expect(listStartableLists(db, userId)).not.toContain(bare.id);
    // A member who isn't its admin can't start agents on it.
    expect(listStartableLists(db, lorna)).toEqual([]);
  });
});
