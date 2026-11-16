import { createHash } from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { formatItemRef } from "../lib/itemRef";
import { type AuditOrigin, recordAudit } from "./audit";
import type { Db } from "./db";
import { resolvePosition } from "./fracidx";
import { projectRefPrefixes } from "./itemRef";
import { assigneeLabel, getItem, listSubItems } from "./items";
import { ensureLabels, type LabelEmoji } from "./labels";
import { listAssignees } from "./members";
import { getProject } from "./projects";
import { type Item, itemRefAliases, items, labels, type Project, projects } from "./schema";

/** What to do with an item's labels that the list it moves to doesn't have. */
export type MissingLabels = "create" | "drop";

/**
 * What moving an item to another list will do, for the person to confirm
 * before it happens: every item that moves (the item, then its sub-items,
 * which go with it) and the ref it gets, how its labels carry over, and who
 * comes off it.
 */
export interface MovePlan {
  from: { id: string; name: string };
  to: { id: string; name: string };
  /** Each item that moves, with its display ref now and the one it gets. */
  refs: { id: string; title: string; from: string; to: string }[];
  /** Labels the list has already, matched by name ignoring case: the name
   * on the item, and the list's own spelling it takes. */
  matchedLabels: { from: string; to: string }[];
  /** Labels the list doesn't have: created there or dropped, as chosen. */
  missingLabels: string[];
  /** People assigned who can't see the list, so they come off the items. */
  unassigned: { userId: string; name: string }[];
  /** Names this exact plan; moveItem needs it back, so a move can't skip
   * its preview, and is refused if anything above changed since. */
  token: string;
}

interface Planned extends Omit<MovePlan, "token"> {
  moving: Item[];
  item: Item;
  source: Project;
  target: Project;
  /** Item id → the number it gets in the target list (null: a new one). */
  restored: Map<string, number>;
  targetLabels: Map<string, string>;
  allowed: Set<string>;
}

function plan(db: Db, userId: string, id: string, projectId: string): Planned {
  const item = getItem(db, userId, id);
  if (!item) throw new Error(`item not found: ${id}`);
  const target = getProject(db, userId, projectId);
  if (!target) throw new Error(`list not found: ${projectId}`);
  if (target.id === item.projectId) throw new Error(`"${item.title}" is already in that list`);
  if (target.status === "archived") throw new Error("can't move an item into an archived list");
  const source = getProject(db, userId, item.projectId);
  if (!source) throw new Error(`list not found: ${item.projectId}`);
  const moving = [item, ...listSubItems(db, userId, item.id)];

  // An item moving back to a list it was in gets its old number there back.
  const restored = new Map<string, number>();
  for (const it of moving) {
    const alias = db
      .select({ number: itemRefAliases.number })
      .from(itemRefAliases)
      .where(and(eq(itemRefAliases.itemId, it.id), eq(itemRefAliases.projectId, target.id)))
      .get();
    if (alias) restored.set(it.id, alias.number);
  }
  const prefixes = projectRefPrefixes(db, userId);
  let next = target.itemSeq;
  const refs = moving.map((it) => ({
    id: it.id,
    title: it.title,
    from: formatItemRef(prefixes[source.id] ?? source.prefix, it.number),
    to: formatItemRef(prefixes[target.id] ?? target.prefix, restored.get(it.id) ?? ++next),
  }));

  const targetLabels = new Map(
    db
      .select({ name: labels.name })
      .from(labels)
      .where(eq(labels.projectId, target.id))
      .all()
      .map((l) => [l.name.toLowerCase(), l.name]),
  );
  const matchedLabels: MovePlan["matchedLabels"] = [];
  const missingLabels: string[] = [];
  const seen = new Set<string>();
  for (const name of moving.flatMap((it) => it.labels)) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const there = targetLabels.get(key);
    if (there) matchedLabels.push({ from: name, to: there });
    else missingLabels.push(name);
  }

  const allowed = new Set(listAssignees(db, userId, target.id).map((a) => a.userId));
  const unassigned = [
    ...new Set(moving.flatMap((it) => it.assigneeIds).filter((a) => !allowed.has(a))),
  ].map((a) => ({ userId: a, name: assigneeLabel(db, a) }));

  return {
    from: { id: source.id, name: source.name },
    to: { id: target.id, name: target.name },
    refs,
    matchedLabels,
    missingLabels,
    unassigned,
    moving,
    item,
    source,
    target,
    restored,
    targetLabels,
    allowed,
  };
}

/** What moving item `id` to list `projectId` would do; changes nothing. */
export function previewMoveItem(
  db: Db,
  userId: string,
  id: string,
  projectId: string,
): MovePlan {
  return describe(userId, plan(db, userId, id, projectId));
}

/** The plan as the person sees it, with the token that names it: a digest
 * of everything shown, so any change to what the move would do changes it. */
function describe(userId: string, p: Planned): MovePlan {
  const { from, to, refs, matchedLabels, missingLabels, unassigned } = p;
  const shown = { from, to, refs, matchedLabels, missingLabels, unassigned };
  const token = createHash("sha256")
    .update(JSON.stringify({ userId, ...shown }))
    .digest("hex")
    .slice(0, 16);
  return { ...shown, token };
}

/**
 * Move an item, with its sub-items, to the top of another list the user can
 * see; a sub-item moves out of its checklist on its own. Each gets the next
 * ref there (or its old one, moving back), and its old ref keeps resolving to
 * it (item_ref_aliases). Labels the list has are matched by name; the rest
 * are created there or dropped, as `missingLabels` says, which is required
 * when there are any. People who can't see the list come off the items.
 * Logged in both lists' history. Needs the `token` from previewMoveItem,
 * so it only does a move someone has seen, and refuses it if anything the
 * preview showed has changed since. Returns what it did, as previewMoveItem
 * described it.
 */
export function moveItem(
  db: Db,
  userId: string,
  id: string,
  input: { projectId: string; token: string; missingLabels?: MissingLabels },
  source: AuditOrigin,
): MovePlan & { item: Item } {
  const p = plan(db, userId, id, input.projectId);
  const shown = describe(userId, p);
  if (input.token !== shown.token) {
    throw new Error("the move has changed since it was previewed, or wasn't previewed: preview it again");
  }
  if (p.missingLabels.length > 0 && !input.missingLabels) {
    throw new Error(
      `"${p.target.name}" has no ${p.missingLabels.join(", ")} label: choose whether to create or drop them`,
    );
  }
  const create = input.missingLabels === "create";
  const emoji: Record<string, LabelEmoji> = {};
  if (create) {
    for (const l of db
      .select()
      .from(labels)
      .where(eq(labels.projectId, p.source.id))
      .all()) {
      emoji[l.name] = { emoji: l.emoji, chosen: l.emojiChosen };
    }
  }
  const position = resolvePosition(
    db
      .select({ id: items.id, position: items.position })
      .from(items)
      .where(and(eq(items.projectId, p.target.id), isNull(items.parentId)))
      .orderBy(asc(items.position), asc(items.id))
      .all(),
    "first",
  );
  const dropped = p.missingLabels.length > 0 && !create ? p.missingLabels : [];

  db.transaction((tx) => {
    const t = tx as unknown as Db;
    if (create) ensureLabels(t, p.target.id, p.missingLabels, emoji);
    p.moving.forEach((it, i) => {
      // The item and its sub-items leave their numbers behind as aliases.
      tx.delete(itemRefAliases)
        .where(and(eq(itemRefAliases.itemId, it.id), eq(itemRefAliases.projectId, p.target.id)))
        .run();
      tx.insert(itemRefAliases)
        .values({ projectId: p.source.id, number: it.number, itemId: it.id })
        .run();
      // Bumped and read back in one statement, as addItem does.
      const number =
        p.restored.get(it.id) ??
        tx
          .update(projects)
          .set({ itemSeq: sql`${projects.itemSeq} + 1` })
          .where(eq(projects.id, p.target.id))
          .returning({ seq: projects.itemSeq })
          .get()?.seq;
      if (number === undefined) throw new Error(`list not found: ${p.target.id}`);
      const itemLabels = [
        ...new Set(
          it.labels.flatMap((name) => {
            const there = p.targetLabels.get(name.toLowerCase());
            return there ? [there] : create ? [name] : [];
          }),
        ),
      ];
      const isTop = it === p.item;
      tx.update(items)
        .set({
          projectId: p.target.id,
          number,
          labels: itemLabels,
          assigneeIds: it.assigneeIds.filter((a) => p.allowed.has(a)),
          ...(isTop ? { parentId: null, position } : {}),
        })
        .where(eq(items.id, it.id))
        .run();

      const { from, to } = p.refs[i];
      const notes = isTop
        ? [
            p.moving.length > 1 ? `with ${p.moving.length - 1} sub-items` : "",
            dropped.length ? `dropped labels ${dropped.join(", ")}` : "",
            p.unassigned.length
              ? `unassigned ${p.unassigned.map((u) => u.name).join(", ")}`
              : "",
          ]
            .filter(Boolean)
            .map((n) => `, ${n}`)
            .join("")
        : "";
      const what = isTop ? `"${it.title}"` : `"${it.title}" with "${p.item.title}"`;
      // One row in each list's history; a sub-item's rows also show in
      // its parent's.
      recordAudit(t, {
        actor: userId,
        source,
        action: "update",
        entityType: "item",
        entityId: it.id,
        projectId: p.source.id,
        parentId: isTop ? it.parentId : p.item.id,
        detail: `moved ${what} (${from}) to "${p.target.name}" as ${to}${notes}`,
      });
      recordAudit(t, {
        actor: userId,
        source,
        action: "update",
        entityType: "item",
        entityId: it.id,
        projectId: p.target.id,
        parentId: isTop ? null : p.item.id,
        detail: `moved ${what} in from "${p.source.name}" (${from} → ${to})${notes}`,
      });
    });
  });

  const moved = getItem(db, userId, id);
  if (!moved) throw new Error(`item not found: ${id}`);
  return { ...shown, item: moved };
}
