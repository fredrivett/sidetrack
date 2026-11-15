import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { formatItemRef, parseItemRef, refsInPrTitle } from "../lib/itemRef";
import { type AuditOrigin, recordAudit } from "./audit";
import type { Db } from "./db";
import { projectRefPrefixes, resolveItemRef } from "./itemRef";
import { completeItem, getItem } from "./items";
import {
  canonicalizePrUrl,
  linkItemToPr,
  listItemsForPr,
  setPrState,
  unlinkItemFromPr,
} from "./prLinks";
import { githubWebhooks } from "./schema";

// A user's GitHub webhook (see the githubWebhooks table): GitHub posts pull
// request events to it, and Sidetrack links the items a PR title names in
// square brackets to the PR, then completes the PR's items when it merges.
// Changes made from a delivery are audited with the `github` source, as the
// webhook's owner.

/** The webhook as settings shows it: never the secret. */
export type GithubWebhookView = {
  id: string;
  createdAt: number;
  lastDeliveryAt: number | null;
};

export function getGithubWebhook(db: Db, userId: string): GithubWebhookView | null {
  return (
    db
      .select({
        id: githubWebhooks.id,
        createdAt: githubWebhooks.createdAt,
        lastDeliveryAt: githubWebhooks.lastDeliveryAt,
      })
      .from(githubWebhooks)
      .where(eq(githubWebhooks.userId, userId))
      .get() ?? null
  );
}

/**
 * Set up the user's webhook, or give it a new secret if it exists (its URL
 * stays the same, so only the secret needs changing in GitHub). Returns the
 * secret, the only time it's handed out.
 */
export function setUpGithubWebhook(
  db: Db,
  userId: string,
  source: AuditOrigin,
): { webhook: GithubWebhookView; secret: string } {
  const existing = getGithubWebhook(db, userId);
  const secret = randomBytes(32).toString("hex");
  const id = existing?.id ?? nanoid(21);
  db.transaction((tx) => {
    if (existing) {
      tx.update(githubWebhooks)
        .set({ secret })
        .where(eq(githubWebhooks.id, id))
        .run();
    } else {
      tx.insert(githubWebhooks)
        .values({ id, userId, secret, createdAt: Date.now() })
        .run();
    }
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      action: existing ? "update" : "create",
      entityType: "webhook",
      entityId: id,
      detail: existing ? "gave the GitHub webhook a new secret" : "set up the GitHub webhook",
    });
  });
  const webhook = getGithubWebhook(db, userId);
  if (!webhook) throw new Error(`webhook not found after setup: ${id}`);
  return { webhook, secret };
}

/** Remove the user's webhook; deliveries to its URL are then refused. */
export function removeGithubWebhook(db: Db, userId: string, source: AuditOrigin): boolean {
  const existing = getGithubWebhook(db, userId);
  if (!existing) return false;
  db.transaction((tx) => {
    tx.delete(githubWebhooks).where(eq(githubWebhooks.id, existing.id)).run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      action: "delete",
      entityType: "webhook",
      entityId: existing.id,
      detail: "removed the GitHub webhook",
    });
  });
  return true;
}

/**
 * Check a delivery to webhook `id` against GitHub's X-Hub-Signature-256
 * header (`sha256=<hex HMAC of the raw body>`), in constant time. Returns the
 * webhook's owner, or null for an unknown webhook or a bad signature. A good
 * delivery records its time, unaudited like an API key's last use: it fires
 * on every delivery and changes nothing on the board.
 */
export function verifyGithubDelivery(
  db: Db,
  id: string,
  body: string,
  signature: string | null,
): { userId: string } | null {
  const hook = db.select().from(githubWebhooks).where(eq(githubWebhooks.id, id)).get();
  if (!hook || !signature?.startsWith("sha256=")) return null;
  const given = Buffer.from(signature.slice("sha256=".length), "hex");
  const expected = createHmac("sha256", hook.secret).update(body).digest();
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  // audit-exempt: delivery telemetry on every webhook call, not a user action.
  db.update(githubWebhooks)
    .set({ lastDeliveryAt: Date.now() })
    .where(eq(githubWebhooks.id, id))
    .run();
  return { userId: hook.userId };
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
};

/**
 * Apply a `pull_request` event for the webhook's owner. Every delivery records
 * the PR's state (open, draft, merged, closed) on its links. A PR closed
 * without merging changes nothing else. Otherwise the title owns the links it
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
  const result: PullRequestResult = { linked: [], unlinked: [], unresolved: [], completed: [] };
  const prState = event.merged
    ? "merged"
    : event.state === "closed"
      ? "closed"
      : event.draft
        ? "draft"
        : "open";
  if (event.action === "closed" && !event.merged) {
    setPrState(db, userId, prUrl, prState);
    return result;
  }
  const prefixes = projectRefPrefixes(db, userId);
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
