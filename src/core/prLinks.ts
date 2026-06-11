import { and, asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { hasProjectAccess } from "./access";
import { recordAudit } from "./audit";
import type { Db } from "./db";
import { getItem } from "./items";
import {
  type AuditSource,
  type ItemPrLink,
  items,
  itemPrLinks,
  projects,
} from "./schema";

// PR links are accessed transitively through their item → project. Reads join
// items+projects and filter via hasProjectAccess so a user only ever sees links
// on items in projects they have access to; writes verify item access via
// getItem() first.

const GITHUB_PR_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/.*)?$/;

/**
 * Accept only github.com pull request URLs and return them in canonical
 * `https://github.com/<owner>/<repo>/pull/<n>` form. Strips trailing
 * sub-paths (e.g. /files), query strings, and fragments, and lowercases
 * owner/repo (GitHub treats them case-insensitively, so case-variant URLs
 * for the same PR must collapse to one link). Throws on anything else so
 * unsafe schemes (javascript:, data:, etc.) can never be persisted.
 */
export function canonicalizePrUrl(raw: string): string {
  const input = raw.trim();
  if (!input) throw new Error("pr_url is required");
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`pr_url is not a valid URL: ${input}`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`pr_url must use https (got ${url.protocol})`);
  }
  const host = url.host.toLowerCase().replace(/^www\./, "");
  if (host !== "github.com") {
    throw new Error(`pr_url must be a github.com URL (got ${url.host})`);
  }
  const m = url.pathname.match(GITHUB_PR_PATH);
  if (!m) {
    throw new Error(
      `pr_url must look like https://github.com/<owner>/<repo>/pull/<n>`,
    );
  }
  const [, owner, repo, number] = m;
  return `https://github.com/${owner.toLowerCase()}/${repo.toLowerCase()}/pull/${number}`;
}

export function listAllPrLinks(db: Db, userId: string): ItemPrLink[] {
  return db
    .select({ itemPrLinks })
    .from(itemPrLinks)
    .innerJoin(items, eq(items.id, itemPrLinks.itemId))
    .innerJoin(projects, eq(projects.id, items.projectId))
    .where(hasProjectAccess(userId))
    .orderBy(asc(itemPrLinks.createdAt))
    .all()
    .map((row) => row.itemPrLinks);
}

export function listPrLinksForItem(
  db: Db,
  userId: string,
  itemId: string,
): ItemPrLink[] {
  return db
    .select({ itemPrLinks })
    .from(itemPrLinks)
    .innerJoin(items, eq(items.id, itemPrLinks.itemId))
    .innerJoin(projects, eq(projects.id, items.projectId))
    .where(and(eq(itemPrLinks.itemId, itemId), hasProjectAccess(userId)))
    .orderBy(asc(itemPrLinks.createdAt))
    .all()
    .map((row) => row.itemPrLinks);
}

export function listItemsForPr(
  db: Db,
  userId: string,
  prUrl: string,
): ItemPrLink[] {
  return db
    .select({ itemPrLinks })
    .from(itemPrLinks)
    .innerJoin(items, eq(items.id, itemPrLinks.itemId))
    .innerJoin(projects, eq(projects.id, items.projectId))
    .where(and(eq(itemPrLinks.prUrl, prUrl), hasProjectAccess(userId)))
    .all()
    .map((row) => row.itemPrLinks);
}

/**
 * Idempotent: if the (item, pr_url) pair already exists, returns the existing
 * row and does NOT write a duplicate audit entry.
 */
export function linkItemToPr(
  db: Db,
  userId: string,
  itemId: string,
  prUrlRaw: string,
  source: AuditSource,
): ItemPrLink {
  const item = getItem(db, userId, itemId);
  if (!item) throw new Error(`item not found: ${itemId}`);
  const prUrl = canonicalizePrUrl(prUrlRaw);

  const existing = db
    .select()
    .from(itemPrLinks)
    .where(and(eq(itemPrLinks.itemId, itemId), eq(itemPrLinks.prUrl, prUrl)))
    .get();
  if (existing) return existing;

  const id = nanoid(12);
  db.transaction((tx) => {
    tx.insert(itemPrLinks)
      .values({ id, itemId, prUrl, linkedBySource: source })
      .run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      action: "link",
      entityType: "item",
      entityId: itemId,
      projectId: item.projectId,
      detail: `linked PR ${prUrl} to "${item.title}"`,
    });
  });

  const created = db
    .select()
    .from(itemPrLinks)
    .where(eq(itemPrLinks.id, id))
    .get();
  // Guaranteed to exist — we just inserted it in the committed transaction.
  // A miss means an invariant broke, so fail loudly rather than return undefined.
  if (!created) throw new Error(`pr link not found after insert: ${id}`);
  return created;
}

/** No-op (no audit) if the link doesn't exist. */
export function unlinkItemFromPr(
  db: Db,
  userId: string,
  itemId: string,
  prUrlRaw: string,
  source: AuditSource,
): void {
  const item = getItem(db, userId, itemId);
  if (!item) throw new Error(`item not found: ${itemId}`);
  const prUrl = canonicalizePrUrl(prUrlRaw);

  const existing = db
    .select()
    .from(itemPrLinks)
    .where(and(eq(itemPrLinks.itemId, itemId), eq(itemPrLinks.prUrl, prUrl)))
    .get();
  if (!existing) return;

  db.transaction((tx) => {
    tx.delete(itemPrLinks)
      .where(and(eq(itemPrLinks.itemId, itemId), eq(itemPrLinks.prUrl, prUrl)))
      .run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      action: "unlink",
      entityType: "item",
      entityId: itemId,
      projectId: item.projectId,
      detail: `unlinked PR ${prUrl} from "${item.title}"`,
    });
  });
}
