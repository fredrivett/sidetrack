import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { formatItemRef, parseItemRef, refsInPrTitle } from "../lib/itemRef";
import { endAgentSessions } from "./agentSessions";
import { type AuditOrigin, recordAudit } from "./audit";
import type { Db } from "./db";
import { projectRefPrefixes, resolveItemRef } from "./itemRef";
import { completeItem, getItem } from "./items";
import {
  canonicalizePrUrl,
  linkItemToPr,
  listItemsForPr,
  listPrLinksForItem,
  setPrState,
  unlinkItemFromPr,
} from "./prLinks";
import { githubWebhookSecrets, githubWebhooks } from "./schema";

// A user's GitHub webhook (see the githubWebhooks table): GitHub posts pull
// request events to it, and Sidetrack links the items a PR title names in
// square brackets to the PR, then completes the PR's items when it merges.
// Changes made from a delivery are audited with the `github` source, as the
// webhook's owner.

/** A secret as settings shows it: its name and use, never the value. */
export type GithubWebhookSecretView = {
  id: string;
  name: string;
  createdAt: number;
  lastDeliveryAt: number | null;
};

/** The webhook as settings shows it, with its secrets, oldest first. */
export type GithubWebhookView = {
  id: string;
  createdAt: number;
  secrets: GithubWebhookSecretView[];
};

export function getGithubWebhook(db: Db, userId: string): GithubWebhookView | null {
  const hook = db
    .select({ id: githubWebhooks.id, createdAt: githubWebhooks.createdAt })
    .from(githubWebhooks)
    .where(eq(githubWebhooks.userId, userId))
    .get();
  if (!hook) return null;
  const secrets = db
    .select({
      id: githubWebhookSecrets.id,
      name: githubWebhookSecrets.name,
      createdAt: githubWebhookSecrets.createdAt,
      lastDeliveryAt: githubWebhookSecrets.lastDeliveryAt,
    })
    .from(githubWebhookSecrets)
    .where(eq(githubWebhookSecrets.webhookId, hook.id))
    // rowid breaks ties between secrets added in the same millisecond.
    .orderBy(asc(githubWebhookSecrets.createdAt), sql`rowid`)
    .all();
  return { ...hook, secrets };
}

/**
 * Add a named secret to the user's webhook, setting the webhook up first if
 * there isn't one. Its URL never changes, so each repository can have its own
 * secret, and rotating one is adding a new secret, pasting it into GitHub,
 * then removing the old one. Returns the secret, the only time it's handed out,
 * with its id.
 */
export function addGithubWebhookSecret(
  db: Db,
  userId: string,
  name: string,
  source: AuditOrigin,
): { webhook: GithubWebhookView; id: string; secret: string } {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("secret name required");
  const existing = getGithubWebhook(db, userId);
  const secret = randomBytes(32).toString("hex");
  const id = existing?.id ?? nanoid(21);
  const secretId = nanoid(12);
  const now = Date.now();
  db.transaction((tx) => {
    if (!existing) {
      tx.insert(githubWebhooks).values({ id, userId, createdAt: now }).run();
    }
    tx.insert(githubWebhookSecrets)
      .values({ id: secretId, webhookId: id, name: trimmed, secret, createdAt: now })
      .run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      event: {
        type: "github.secret.added",
        webhookId: id,
        secretId,
        name: trimmed,
        first: !existing,
      },
    });
  });
  const webhook = getGithubWebhook(db, userId);
  if (!webhook) throw new Error(`webhook not found after setup: ${id}`);
  return { webhook, id: secretId, secret };
}

/**
 * Remove one of the webhook's secrets; deliveries signed with it are then
 * refused. The webhook stays, even with no secrets left.
 */
export function removeGithubWebhookSecret(
  db: Db,
  userId: string,
  secretId: string,
  source: AuditOrigin,
): boolean {
  const webhook = getGithubWebhook(db, userId);
  const secret = webhook?.secrets.find((s) => s.id === secretId);
  if (!webhook || !secret) return false;
  db.transaction((tx) => {
    tx.delete(githubWebhookSecrets).where(eq(githubWebhookSecrets.id, secret.id)).run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      event: {
        type: "github.secret.removed",
        webhookId: webhook.id,
        secretId: secret.id,
        name: secret.name,
      },
    });
  });
  return true;
}

/** Remove the user's webhook and its secrets; deliveries to its URL are then refused. */
export function removeGithubWebhook(db: Db, userId: string, source: AuditOrigin): boolean {
  const existing = getGithubWebhook(db, userId);
  if (!existing) return false;
  db.transaction((tx) => {
    // Its secrets go with it (on delete cascade).
    tx.delete(githubWebhooks).where(eq(githubWebhooks.id, existing.id)).run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      event: { type: "github.webhook.removed", webhookId: existing.id },
    });
  });
  return true;
}

/**
 * Check a delivery to webhook `id` against GitHub's X-Hub-Signature-256
 * header (`sha256=<hex HMAC of the raw body>`), trying each of its secrets in
 * constant time. Returns the webhook's owner, or null for an unknown webhook
 * or a signature no secret made. A good delivery records its time on the
 * secret that signed it, unaudited like an API key's last use: it fires on
 * every delivery and changes nothing on the board.
 */
export function verifyGithubDelivery(
  db: Db,
  id: string,
  body: string,
  signature: string | null,
): { userId: string } | null {
  if (!signature?.startsWith("sha256=")) return null;
  const given = Buffer.from(signature.slice("sha256=".length), "hex");
  const secrets = db
    .select({
      id: githubWebhookSecrets.id,
      secret: githubWebhookSecrets.secret,
      userId: githubWebhooks.userId,
    })
    .from(githubWebhookSecrets)
    .innerJoin(githubWebhooks, eq(githubWebhooks.id, githubWebhookSecrets.webhookId))
    .where(eq(githubWebhooks.id, id))
    .all();
  const match = secrets.find((s) => {
    const expected = createHmac("sha256", s.secret).update(body).digest();
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!match) return null;
  // audit-exempt: delivery telemetry on every webhook call, not a user action.
  db.update(githubWebhookSecrets)
    .set({ lastDeliveryAt: Date.now() })
    .where(eq(githubWebhookSecrets.id, match.id))
    .run();
  return { userId: match.userId };
}

/** What a pull request delivery did, reported back to GitHub's delivery log. */
export type PullRequestResult = {
  /** Refs from the title now linked to the PR. */
  linked: string[];
  /** Items a previous title linked that this one no longer names, by ref. */
  unlinked: string[];
  /** Refs from the title that matched no item on the board (or several). */
  unresolved: string[];
  /** Items completed because the PR merged, by ref. */
  completed: string[];
  /** Items whose agents stopped work because the PR closed unmerged, by ref. */
  finished: string[];
};

/**
 * Apply a `pull_request` event for the webhook's owner. Every delivery records
 * the PR's state (open, draft, merged, closed) on its links. A PR closed
 * without merging changes no links or items, but ends the agents' work on its
 * items (merging ends it too, by completing them). Otherwise the title owns the links it
 * made: link
 * every item it names in square brackets, and unlink items a previous title
 * linked that it no longer names (linking and unlinking are idempotent, so
 * edits and pushes repeat harmlessly). Links an agent or the web made are left
 * alone, even when the title doesn't name their item. Then, when the PR merged,
 * complete every open item still linked to it, however it was linked. A ref
 * that's unknown or ambiguous on the board is skipped, never guessed, and keeps
 * any link the title made to an item with that ref.
 */
export function applyPullRequestEvent(
  db: Db,
  userId: string,
  event: {
    action: string;
    /** The PR's `state` on GitHub. */
    state: "open" | "closed";
    merged: boolean;
    draft: boolean;
    title: string;
    url: string;
  },
): PullRequestResult {
  const prUrl = canonicalizePrUrl(event.url);
  const result: PullRequestResult = {
    linked: [],
    unlinked: [],
    unresolved: [],
    completed: [],
    finished: [],
  };
  const prState = event.merged
    ? "merged"
    : event.state === "closed"
      ? "closed"
      : event.draft
        ? "draft"
        : "open";
  const prefixes = projectRefPrefixes(db, userId);
  if (event.action === "closed" && !event.merged) {
    setPrState(db, userId, prUrl, prState);
    // The work this PR carried has stopped: take its agents off its items,
    // unless an item has another PR that may still be open (say, a
    // replacement): one not known to be merged or closed, including one whose
    // state no delivery has reported yet.
    for (const link of listItemsForPr(db, userId, prUrl)) {
      const item = getItem(db, userId, link.itemId);
      if (!item || item.completedAt !== null) continue;
      const otherOpen = listPrLinksForItem(db, userId, item.id).some(
        (l) => l.prUrl !== prUrl && l.prState !== "merged" && l.prState !== "closed",
      );
      if (otherOpen) continue;
      if (endAgentSessions(db, userId, item.id, "PR closed without merging", "github") > 0) {
        result.finished.push(formatItemRef(prefixes[item.projectId] ?? "", item.number));
      }
    }
    return result;
  }
  const named = new Set<string>();
  // Title refs that don't resolve now (say, ambiguous since a project was
  // shared), as PREFIX-N: the title may still mean an item it linked before.
  const unresolved = new Set<string>();
  for (const ref of refsInPrTitle(event.title)) {
    const r = resolveItemRef(db, userId, ref);
    if (r.status !== "ok") {
      result.unresolved.push(ref);
      const parsed = parseItemRef(ref);
      if (parsed) unresolved.add(formatItemRef(parsed.prefix, parsed.number));
      continue;
    }
    linkItemToPr(db, userId, r.item.id, prUrl, "github");
    named.add(r.item.id);
    result.linked.push(ref);
  }
  for (const link of listItemsForPr(db, userId, prUrl)) {
    if (link.linkedBySource !== "github" || named.has(link.itemId)) continue;
    const item = getItem(db, userId, link.itemId);
    if (!item) continue;
    const ref = formatItemRef(prefixes[item.projectId] ?? "", item.number);
    const parsed = parseItemRef(ref);
    if (parsed && unresolved.has(formatItemRef(parsed.prefix, parsed.number))) continue;
    unlinkItemFromPr(db, userId, item.id, prUrl, "github");
    result.unlinked.push(ref);
  }
  setPrState(db, userId, prUrl, prState);
  if (event.action === "closed" && event.merged) {
    for (const link of listItemsForPr(db, userId, prUrl)) {
      const item = getItem(db, userId, link.itemId);
      if (!item || item.completedAt !== null) continue;
      completeItem(db, userId, item.id, "github");
      result.completed.push(formatItemRef(prefixes[item.projectId] ?? "", item.number));
    }
  }
  return result;
}
