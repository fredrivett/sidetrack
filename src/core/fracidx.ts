import { generateKeyBetween } from "fractional-indexing";

/**
 * Position convention: lower position string sorts first (ASC) and renders
 * topmost in the UI. For items within a project:
 *   - completed items occupy the upper UI range (= smallest positions)
 *   - newest-completed has the LARGEST position among completed items
 *     (closest to the active boundary)
 *   - active items follow (= larger positions than any completed item)
 *   - within active, the top active item has the smallest active position
 */

export type PositionRef =
  | "top"
  | "end"
  | { after: string }
  | { before: string };

export type ProjectPositionRef =
  | "start"
  | "end"
  | { after: string }
  | { before: string };

export function parseRef(raw: string | undefined): PositionRef {
  if (!raw || raw === "end") return "end";
  if (raw === "top") return "top";
  if (raw.startsWith("after:")) return { after: raw.slice("after:".length) };
  if (raw.startsWith("before:")) return { before: raw.slice("before:".length) };
  throw new Error(`invalid position ref: ${raw}`);
}

export function parseProjectRef(raw: string | undefined): ProjectPositionRef {
  if (!raw || raw === "end") return "end";
  if (raw === "start") return "start";
  if (raw.startsWith("after:")) return { after: raw.slice("after:".length) };
  if (raw.startsWith("before:")) return { before: raw.slice("before:".length) };
  throw new Error(`invalid position ref: ${raw}`);
}

export function between(a: string | null, b: string | null): string {
  return generateKeyBetween(a, b);
}

interface PositionedSibling {
  id: string;
  position: string;
  completedAt: number | null;
}

/**
 * Resolve a position ref against the current siblings of an item.
 * Siblings must be sorted by position ASC.
 */
export function resolveItemPosition(
  siblings: PositionedSibling[],
  ref: PositionRef,
): string {
  const completed = siblings.filter((s) => s.completedAt !== null);
  const active = siblings.filter((s) => s.completedAt === null);
  const maxCompleted = completed.at(-1)?.position ?? null;
  const minActive = active[0]?.position ?? null;
  const maxActive = active.at(-1)?.position ?? null;

  if (ref === "top") {
    // Top of active range: just below max-completed (or at the global top if
    // no completed) and just above the current top active item.
    return between(maxCompleted, minActive);
  }
  if (ref === "end") {
    // Bottom of active range: just below the current last active item.
    // If there are no active items, this is between maxCompleted and null.
    return between(maxActive ?? maxCompleted, null);
  }

  const targetId = "after" in ref ? ref.after : ref.before;
  const idx = siblings.findIndex((s) => s.id === targetId);
  if (idx === -1) {
    throw new Error(`sibling not found: ${targetId}`);
  }
  if ("after" in ref) {
    const next = siblings[idx + 1]?.position ?? null;
    return between(siblings[idx].position, next);
  }
  const prev = idx > 0 ? siblings[idx - 1].position : null;
  return between(prev, siblings[idx].position);
}

/**
 * Position for a newly-completed item: just above the current top active
 * item, just below the previous newest-completed (= the new boundary slot
 * on the completed side).
 */
export function resolveCompletePosition(
  siblings: PositionedSibling[],
  completingId: string,
): string {
  const others = siblings.filter((s) => s.id !== completingId);
  const completed = others.filter((s) => s.completedAt !== null);
  const active = others.filter((s) => s.completedAt === null);
  const maxCompleted = completed.at(-1)?.position ?? null;
  const minActive = active[0]?.position ?? null;
  return between(maxCompleted, minActive);
}

/**
 * Position for an item being uncompleted: top of the active range
 * (= same boundary slot as a fresh complete, but on the active side now).
 */
export function resolveUncompletePosition(
  siblings: PositionedSibling[],
  uncompletingId: string,
): string {
  const others = siblings.filter((s) => s.id !== uncompletingId);
  const completed = others.filter((s) => s.completedAt !== null);
  const active = others.filter((s) => s.completedAt === null);
  const maxCompleted = completed.at(-1)?.position ?? null;
  const minActive = active[0]?.position ?? null;
  return between(maxCompleted, minActive);
}

/** Project list positions — no completed/active distinction. */
export function resolveProjectPosition(
  projects: Array<{ id: string; position: string }>,
  ref: ProjectPositionRef,
): string {
  const sorted = projects;
  if (ref === "start") return between(null, sorted[0]?.position ?? null);
  if (ref === "end") return between(sorted.at(-1)?.position ?? null, null);

  const targetId = "after" in ref ? ref.after : ref.before;
  const idx = sorted.findIndex((p) => p.id === targetId);
  if (idx === -1) throw new Error(`project not found: ${targetId}`);
  if ("after" in ref) {
    return between(sorted[idx].position, sorted[idx + 1]?.position ?? null);
  }
  return between(idx > 0 ? sorted[idx - 1].position : null, sorted[idx].position);
}
