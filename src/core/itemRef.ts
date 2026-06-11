import { and, eq } from "drizzle-orm";
import { parseItemRef } from "../lib/itemRef";
import { users } from "./auth-schema";
import type { Db } from "./db";
import { getItem } from "./items";
import { type Item, items, projects } from "./schema";

export type ResolveItemResult =
  | { status: "ok"; item: Item }
  | {
      status: "ambiguous";
      candidates: { projectId: string; projectName: string; prefix: string }[];
    }
  | { status: "not_found"; reason: "format" | "user" | "prefix" | "number" };

/**
 * Resolve a pasted reference to one of the user's items. Accepts the bare ref
 * `ENG-42`, the qualified `username/ENG-42`, and a raw nanoid id (so existing
 * callers and copied internal ids keep working).
 *
 * Fail-closed and never guesses: an ambiguous bare ref returns `ambiguous` with
 * the candidate projects rather than picking one. Today `(user_id, prefix)` is
 * unique per owner and access == ownership, so `ambiguous` is unreachable — but
 * the contract is locked now so the future sharing layer doesn't churn callers.
 */
export function resolveItemRef(
  db: Db,
  userId: string,
  raw: string,
): ResolveItemResult {
  const parsed = parseItemRef(raw);
  if (!parsed) {
    // Not a ref shape — try it as a raw nanoid id (the legacy/internal form).
    const item = getItem(db, userId, raw.trim());
    return item ? { status: "ok", item } : { status: "not_found", reason: "format" };
  }

  if (parsed.username !== null) {
    // A qualifier only resolves within the requester's own namespace today:
    // access == ownership, so there's no cross-user board to point at. We still
    // accept it (a copied `you/ENG-42` resolves) but reject anyone else's.
    const me = db
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, userId))
      .get();
    if (!me || me.username.toLowerCase() !== parsed.username) {
      return { status: "not_found", reason: "user" };
    }
  }

  const matches = db
    .select()
    .from(projects)
    .where(and(eq(projects.userId, userId), eq(projects.prefix, parsed.prefix)))
    .all();
  if (matches.length === 0) return { status: "not_found", reason: "prefix" };
  if (matches.length > 1) {
    return {
      status: "ambiguous",
      candidates: matches.map((p) => ({
        projectId: p.id,
        projectName: p.name,
        prefix: p.prefix,
      })),
    };
  }

  const item = db
    .select({ items })
    .from(items)
    .where(and(eq(items.projectId, matches[0].id), eq(items.number, parsed.number)))
    .get()?.items;
  return item ? { status: "ok", item } : { status: "not_found", reason: "number" };
}
