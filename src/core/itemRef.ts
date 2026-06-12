import { and, eq } from "drizzle-orm";
import { parseItemRef } from "../lib/itemRef";
import { hasProjectAccess } from "./access";
import { users } from "./auth-schema";
import type { Db } from "./db";
import { getItem } from "./items";
import { type Item, items, projects } from "./schema";

export type ResolveItemResult =
  | { status: "ok"; item: Item }
  | {
      status: "ambiguous";
      candidates: {
        projectId: string;
        projectName: string;
        prefix: string;
        /** Owner's username — the qualifier to disambiguate (`owner/PREFIX-N`). */
        ownerUsername: string | null;
      }[];
    }
  | { status: "not_found"; reason: "format" | "user" | "prefix" | "number" };

/** Resolve `(projectId, number)` to an item, or null if no such number. */
function itemByNumber(db: Db, projectId: string, number: number): Item | null {
  return (
    db
      .select({ items })
      .from(items)
      .where(and(eq(items.projectId, projectId), eq(items.number, number)))
      .get()?.items ?? null
  );
}

/**
 * Resolve a pasted reference to one of the items the user can access. Accepts
 * the bare ref `ENG-42`, the qualified `username/ENG-42`, and a raw nanoid id
 * (so existing callers and copied internal ids keep working).
 *
 * Scoping is by access (owner OR member), not ownership — so a shared item
 * resolves too. A bare prefix can now match more than one project the viewer
 * sees (their own `ENG` plus a shared `ENG`); rather than guess, that returns
 * `ambiguous` with the candidate projects (and each owner's username, the
 * qualifier needed to disambiguate). A qualified `owner/ENG-42` pins it to the
 * project with that prefix owned by `owner`, provided the viewer has access.
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
    // Qualified ref: pin to the project with this prefix owned by `username`,
    // but only if the viewer can access it. The qualifier resolves any owner's
    // board the viewer shares, not just their own.
    const owner = db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, parsed.username))
      .get();
    if (!owner) return { status: "not_found", reason: "user" };
    const project = db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.userId, owner.id),
          eq(projects.prefix, parsed.prefix),
          hasProjectAccess(userId),
        ),
      )
      .get();
    if (!project) return { status: "not_found", reason: "prefix" };
    const item = itemByNumber(db, project.id, parsed.number);
    return item ? { status: "ok", item } : { status: "not_found", reason: "number" };
  }

  // Bare ref: every project the viewer can access whose prefix matches.
  const matches = db
    .select({
      id: projects.id,
      name: projects.name,
      prefix: projects.prefix,
      ownerUsername: users.username,
    })
    .from(projects)
    .leftJoin(users, eq(users.id, projects.userId))
    .where(and(hasProjectAccess(userId), eq(projects.prefix, parsed.prefix)))
    .all();
  if (matches.length === 0) return { status: "not_found", reason: "prefix" };
  if (matches.length > 1) {
    return {
      status: "ambiguous",
      candidates: matches.map((p) => ({
        projectId: p.id,
        projectName: p.name,
        prefix: p.prefix,
        ownerUsername: p.ownerUsername,
      })),
    };
  }

  const item = itemByNumber(db, matches[0].id, parsed.number);
  return item ? { status: "ok", item } : { status: "not_found", reason: "number" };
}

/**
 * Per-project display ref-prefix for a viewer's board. A project's prefix is
 * shown bare (`SID`) unless another project the viewer can access shares it, in
 * which case it's qualified with the owner's username (`alice/SID`) so the
 * rendered item refs (`alice/SID-42`) stay unambiguous and resolvable. Keyed by
 * project id. Prefixes are unique per owner, so a clash always involves a
 * shared project.
 */
export function projectRefPrefixes(
  db: Db,
  userId: string,
): Record<string, string> {
  const rows = db
    .select({
      id: projects.id,
      prefix: projects.prefix,
      ownerUsername: users.username,
    })
    .from(projects)
    .leftJoin(users, eq(users.id, projects.userId))
    .where(hasProjectAccess(userId))
    .all();
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.prefix, (counts.get(r.prefix) ?? 0) + 1);
  const out: Record<string, string> = {};
  for (const r of rows) {
    out[r.id] =
      (counts.get(r.prefix) ?? 0) > 1 && r.ownerUsername
        ? `${r.ownerUsername}/${r.prefix}`
        : r.prefix;
  }
  return out;
}
