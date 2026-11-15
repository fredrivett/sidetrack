import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { listAudit } from "./audit";
import {
  applyPullRequestEvent,
  getGithubWebhook,
  removeGithubWebhook,
  setUpGithubWebhook,
  verifyGithubDelivery,
} from "./github";
import { addItem, getItem } from "./items";
import { acceptInvite, inviteMember } from "./members";
import { linkItemToPr, listPrLinksForItem } from "./prLinks";
import { createProject } from "./projects";
import { createTestDb, createTestUser } from "./test-helpers";

const PR = "https://github.com/fredrivett/sidetrack/pull/7";

function seed() {
  const { db } = createTestDb();
  const userId = createTestUser(db, { username: "fred" });
  const p = createProject(db, userId, { name: "Sidetrack" }, "web");
  const one = addItem(db, userId, { projectId: p.id, title: "One" }, "web");
  const two = addItem(db, userId, { projectId: p.id, title: "Two" }, "web");
  return { db, userId, one, two };
}

/** A pull_request delivery, open and ready for review unless it says otherwise. */
const pr = (e: { action: string; title: string; merged?: boolean; draft?: boolean; url?: string }) => ({
  merged: false,
  draft: false,
  url: PR,
  ...e,
  state: e.action === "closed" ? ("closed" as const) : ("open" as const),
});

const sign = (secret: string, body: string) =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

describe("GitHub webhook setup", () => {
  it("gives a new secret on setting up again, keeping the URL, and audits both", () => {
    const { db, userId } = seed();
    const first = setUpGithubWebhook(db, userId, "web");
    const again = setUpGithubWebhook(db, userId, "web");

    expect(again.webhook.id).toBe(first.webhook.id);
    expect(again.secret).not.toBe(first.secret);
    expect(listAudit(db, userId).slice(0, 2).map((e) => [e.action, e.entityType])).toEqual([
      ["update", "webhook"],
      ["create", "webhook"],
    ]);
  });

  it("removes the webhook, after which deliveries are refused", () => {
    const { db, userId } = seed();
    const { webhook, secret } = setUpGithubWebhook(db, userId, "web");
    expect(removeGithubWebhook(db, userId, "web")).toBe(true);
    expect(getGithubWebhook(db, userId)).toBeNull();
    expect(verifyGithubDelivery(db, webhook.id, "{}", sign(secret, "{}"))).toBeNull();
    expect(removeGithubWebhook(db, userId, "web")).toBe(false);
  });
});

describe("verifyGithubDelivery", () => {
  it("accepts only the current secret's signature over the exact body", () => {
    const { db, userId } = seed();
    const old = setUpGithubWebhook(db, userId, "web");
    const { webhook, secret } = setUpGithubWebhook(db, userId, "web");
    const body = '{"zen":"Keep it logically awesome."}';

    expect(verifyGithubDelivery(db, webhook.id, body, sign(secret, body))).toEqual({ userId });
    expect(getGithubWebhook(db, userId)?.lastDeliveryAt).not.toBeNull();
    expect(verifyGithubDelivery(db, webhook.id, body, sign(old.secret, body))).toBeNull();
    expect(verifyGithubDelivery(db, webhook.id, `${body} `, sign(secret, body))).toBeNull();
    expect(verifyGithubDelivery(db, webhook.id, body, null)).toBeNull();
    expect(verifyGithubDelivery(db, webhook.id, body, "sha256=abc")).toBeNull();
    expect(verifyGithubDelivery(db, "nope", body, sign(secret, body))).toBeNull();
  });
});

describe("applyPullRequestEvent", () => {
  it("links the refs in the title, skipping ones the board doesn't have", () => {
    const { db, userId, one, two } = seed();
    const result = applyPullRequestEvent(db, userId, pr({
      action: "opened",
      merged: false,
      title: "[WIP] Ship both [SID-1, SID-2] [SID-99]",
      url: `${PR}/files`,
    }));

    expect(result).toEqual({
      linked: ["SID-1", "SID-2"],
      unlinked: [],
      unresolved: ["SID-99"],
      completed: [],
    });
    for (const it of [one, two]) {
      expect(listPrLinksForItem(db, userId, it.id).map((l) => [l.prUrl, l.linkedBySource])).toEqual([
        [PR, "github"],
      ]);
    }
    expect(getItem(db, userId, one.id)?.completedAt).toBeNull();
    expect(listAudit(db, userId)[0]).toMatchObject({ source: "github", action: "link" });
  });

  it("unlinks refs dropped from the title, keeping links an agent made", () => {
    const { db, userId, one, two } = seed();
    const three = addItem(db, userId, { projectId: one.projectId, title: "Three" }, "web");
    linkItemToPr(db, userId, three.id, PR, { source: "mcp", agent: { keyId: "k1", name: "Amp" } });
    const deliver = (action: string, merged: boolean, title: string) =>
      applyPullRequestEvent(db, userId, pr({ action, merged, title }));
    const linkedItems = () =>
      [one, two, three].filter((it) => listPrLinksForItem(db, userId, it.id).length > 0);

    deliver("opened", false, "Ship [SID-1, SID-2]");
    expect(linkedItems()).toEqual([one, two, three]);

    // SID-2 dropped in the same delivery that merges: it must not be completed.
    const merged = deliver("closed", true, "Ship [SID-1]");
    expect(merged.unlinked).toEqual(["SID-2"]);
    expect(merged.completed.sort()).toEqual(["SID-1", "SID-3"]);
    expect(linkedItems()).toEqual([one, three]);
    expect(getItem(db, userId, two.id)?.completedAt).toBeNull();
    expect(
      listAudit(db, userId).filter((e) => e.action === "unlink").map((e) => [e.source, e.entityId]),
    ).toEqual([["github", two.id]]);

    // A title naming nothing never unlinks the agent's link; a replay is a no-op.
    const auditCount = listAudit(db, userId).length;
    expect(deliver("edited", false, "Ship").unlinked).toEqual(["SID-1"]);
    expect(deliver("edited", false, "Ship").unlinked).toEqual([]);
    expect(linkedItems()).toEqual([three]);
    expect(listAudit(db, userId).length).toBe(auditCount + 1);
  });

  it("records the PR's state on its links, including links made later", () => {
    const { db, userId, one, two } = seed();
    const deliver = (e: Parameters<typeof pr>[0]) => applyPullRequestEvent(db, userId, pr(e));
    const states = () =>
      [one, two].map((it) => listPrLinksForItem(db, userId, it.id).map((l) => l.prState));

    deliver({ action: "opened", draft: true, title: "Ship [SID-1]" });
    expect(states()).toEqual([["draft"], []]);
    deliver({ action: "ready_for_review", title: "Ship [SID-1]" });
    // An agent linking afterwards picks up the state already reported.
    linkItemToPr(db, userId, two.id, PR, "web");
    expect(states()).toEqual([["open"], ["open"]]);

    // Closing unmerged records it, though a title edited at the same time
    // changes no links.
    deliver({ action: "closed", title: "Ship" });
    expect(states()).toEqual([["closed"], ["closed"]]);
    deliver({ action: "reopened", title: "Ship [SID-1]" });
    expect(states()).toEqual([["open"], ["open"]]);
    deliver({ action: "closed", merged: true, title: "Ship [SID-1]" });
    expect(states()).toEqual([["merged"], ["merged"]]);
  });

  it("can't reach another user's items by ref", () => {
    const { db, userId, one } = seed();
    const stranger = createTestUser(db);
    const result = applyPullRequestEvent(db, stranger, pr({
      action: "opened",
      merged: false,
      title: "Steal [fred/SID-1]",
      url: PR,
    }));
    expect(result.linked).toEqual([]);
    expect(listPrLinksForItem(db, userId, one.id)).toEqual([]);
  });

  it("keeps a title link while its ref is ambiguous, and drops it once edited out", () => {
    const { db, userId, one } = seed();
    const deliver = (title: string) =>
      applyPullRequestEvent(db, userId, pr({ action: "edited", title }));
    deliver("Ship [SID-1]");

    // Alice shares her own "Sidetrack" list, so bare SID-1 now names two items.
    const alice = createTestUser(db, { username: "alice" });
    const theirs = createProject(db, alice, { name: "Sidetrack" }, "web");
    addItem(db, alice, { projectId: theirs.id, title: "Hers" }, "web");
    inviteMember(db, alice, theirs.id, "fred", "web");
    acceptInvite(db, userId, theirs.id, "web");

    expect(deliver("Ship [SID-1]")).toMatchObject({ unlinked: [], unresolved: ["SID-1"] });
    expect(listPrLinksForItem(db, userId, one.id)).toHaveLength(1);
    expect(deliver("Ship").unlinked).toEqual(["fred/SID-1"]);
    expect(listPrLinksForItem(db, userId, one.id)).toEqual([]);
  });

  it("completes every open item linked to a merged PR, however it was linked", () => {
    const { db, userId, one, two } = seed();
    // Linked by an agent, not named in the title.
    linkItemToPr(db, userId, two.id, PR, "web");

    const result = applyPullRequestEvent(db, userId, pr({
      action: "closed",
      merged: true,
      title: "Ship it [SID-1]",
      url: PR,
    }));

    expect(result.completed.sort()).toEqual(["SID-1", "SID-2"]);
    expect(getItem(db, userId, one.id)?.completedAt).not.toBeNull();
    expect(getItem(db, userId, two.id)?.completedAt).not.toBeNull();
    expect(
      listAudit(db, userId).filter((e) => e.action === "complete").map((e) => e.source),
    ).toEqual(["github", "github"]);
  });

  it("changes nothing when the PR closes without merging", () => {
    const { db, userId, one } = seed();
    const result = applyPullRequestEvent(db, userId, pr({
      action: "closed",
      merged: false,
      title: "Abandon [SID-1]",
      url: PR,
    }));
    expect(result).toEqual({ linked: [], unlinked: [], unresolved: [], completed: [] });
    expect(getItem(db, userId, one.id)?.completedAt).toBeNull();
    expect(listPrLinksForItem(db, userId, one.id)).toEqual([]);
  });
});
