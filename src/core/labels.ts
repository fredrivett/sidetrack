import { and, asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { isEmoji } from "@/lib/projectIcon";
import { hasProjectAccess } from "./access";
import { type AuditOrigin, recordAudit } from "./audit";
import type { Db } from "./db";
import { type Label, items, labels, projects } from "./schema";

export function listLabels(
  db: Db,
  userId: string,
  projectId: string,
): Label[] {
  return db
    .select({ labels })
    .from(labels)
    .innerJoin(projects, eq(projects.id, labels.projectId))
    .where(and(eq(labels.projectId, projectId), hasProjectAccess(userId)))
    .orderBy(asc(labels.name))
    .all()
    .map((row) => row.labels);
}

/** A label's emoji as someone chose it, or as Jev suggested it (`chosen` false). */
export interface LabelEmoji {
  emoji: string | null;
  chosen: boolean;
}

/** An item's label names: trimmed, blanks dropped, each once, in order. */
export function normalizeLabelNames(names: string[]): string[] {
  return [...new Set(names.map((n) => n.trim()).filter(Boolean))];
}

/** The names among `names` that `projectId` has no label for yet. Callers
 * have already checked access to the project. */
export function newLabelNames(db: Db, projectId: string, names: string[]): string[] {
  const known = new Set(
    db
      .select({ name: labels.name })
      .from(labels)
      .where(eq(labels.projectId, projectId))
      .all()
      .map((l) => l.name),
  );
  return normalizeLabelNames(names).filter((n) => !known.has(n));
}

/** A label's emoji for storage: blank is none; anything else must be one emoji. */
function normalizeEmoji(raw: string | null): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  if (!isEmoji(trimmed)) throw new Error(`not an emoji: ${trimmed}`);
  return trimmed;
}

/**
 * Insert the labels that are missing. Low-level helper used by
 * addItem/updateItem to register labels typed inline, each with its emoji
 * from `emoji` (by name), if any. Intentionally NOT
 * audited on its own: the parent item create/update is the meaningful logged
 * event; auto-created labels would just be noise. Explicit `addLabel` is
 * audited.
 *
 * No userId param: callers (addItem/updateItem) have already verified
 * project access before reaching here.
 */
export function ensureLabels(
  db: Db,
  projectId: string,
  names: string[],
  emoji: Record<string, LabelEmoji> = {},
): void {
  for (const name of names) {
    const existing = db
      .select({ id: labels.id })
      .from(labels)
      .where(and(eq(labels.projectId, projectId), eq(labels.name, name)))
      .get();
    if (existing) continue;
    // audit-exempt: an inline label is noise; the item create or update
    // that adds it is the logged event (see above).
    db.insert(labels)
      .values({
        id: nanoid(12),
        projectId,
        name,
        emoji: normalizeEmoji(emoji[name]?.emoji ?? null),
        emojiChosen: emoji[name]?.chosen ?? false,
      })
      .run();
  }
}

function labelDetail(emoji: string | null, name: string) {
  return emoji ? `${emoji} ${name}` : name;
}

/**
 * Add a label to a list, idempotently. `emoji` is someone's choice unless
 * `emojiChosen` is false (Jev's suggestion for the name); null is no emoji.
 */
export function addLabel(
  db: Db,
  userId: string,
  projectId: string,
  input: { name: string; emoji?: string | null; emojiChosen?: boolean },
  source: AuditOrigin,
): Label {
  const name = input.name.trim();
  if (!name) throw new Error("label name required");
  const accessibleProject = db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), hasProjectAccess(userId)))
    .get();
  if (!accessibleProject) throw new Error(`list not found: ${projectId}`);

  const existing = db
    .select()
    .from(labels)
    .where(and(eq(labels.projectId, projectId), eq(labels.name, name)))
    .get();
  if (existing) return existing;

  const label: Label = {
    id: nanoid(12),
    projectId,
    name,
    emoji: normalizeEmoji(input.emoji ?? null),
    emojiChosen: input.emoji !== undefined && input.emojiChosen !== false,
  };
  db.transaction((tx) => {
    tx.insert(labels).values(label).run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      action: "create",
      entityType: "label",
      entityId: label.id,
      projectId,
      detail: `added label "${labelDetail(label.emoji, name)}"`,
    });
  });
  return label;
}

export function getLabel(db: Db, userId: string, id: string): Label | undefined {
  return db
    .select({ labels })
    .from(labels)
    .innerJoin(projects, eq(projects.id, labels.projectId))
    .where(and(eq(labels.id, id), hasProjectAccess(userId)))
    .get()?.labels;
}

/**
 * Rename a label or change its emoji. A rename carries over to every item
 * with the label. `emoji` is someone's choice unless `emojiChosen` is false,
 * when it's Jev's suggestion for the (new) name: that never replaces an
 * emoji someone chose, including their choice of none.
 */
export function updateLabel(
  db: Db,
  userId: string,
  id: string,
  patch: { name?: string; emoji?: string | null; emojiChosen?: boolean },
  source: AuditOrigin,
): Label {
  const existing = getLabel(db, userId, id);
  if (!existing) throw new Error(`label not found: ${id}`);

  const next: Partial<Label> = {};
  const changes: string[] = [];
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new Error("label name required");
    if (name !== existing.name) {
      const clash = db
        .select({ id: labels.id })
        .from(labels)
        .where(and(eq(labels.projectId, existing.projectId), eq(labels.name, name)))
        .get();
      if (clash) throw new Error(`there's already a label called "${name}"`);
      next.name = name;
      changes.push(`renamed to "${name}"`);
    }
  }
  const chosen = patch.emojiChosen !== false;
  if (patch.emoji !== undefined && (chosen || !existing.emojiChosen)) {
    const emoji = normalizeEmoji(patch.emoji);
    if (emoji !== existing.emoji) {
      next.emoji = emoji;
      changes.push(emoji ? `emoji ${emoji}` : "emoji removed");
    }
    if (chosen !== existing.emojiChosen) {
      next.emojiChosen = chosen;
      // Choosing the emoji it already had (Jev's) is still a choice.
      if (emoji === existing.emoji) changes.push(emoji ? `chose ${emoji}` : "chose no emoji");
    }
  }
  if (Object.keys(next).length === 0) return existing;

  const renamed = next.name;
  db.transaction((tx) => {
    tx.update(labels).set(next).where(eq(labels.id, id)).run();
    if (renamed) {
      const tagged = tx
        .select({ id: items.id, labels: items.labels })
        .from(items)
        .where(eq(items.projectId, existing.projectId))
        .all()
        .filter((it) => it.labels.includes(existing.name));
      for (const it of tagged) {
        tx.update(items)
          .set({
            labels: normalizeLabelNames(
              it.labels.map((l) => (l === existing.name ? renamed : l)),
            ),
          })
          .where(eq(items.id, it.id))
          .run();
      }
    }
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      action: "update",
      entityType: "label",
      entityId: id,
      projectId: existing.projectId,
      detail: `label "${existing.name}": ${changes.join(", ")}`,
    });
  });
  return { ...existing, ...next };
}
