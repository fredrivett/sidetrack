import { generateKeyBetween } from "fractional-indexing";

/**
 * Ordering for items within a list and for lists on a viewer's board.
 *
 * `position` is a fractional-index string: lower sorts first (ASC) and renders
 * first (topmost for items, leftmost for lists). It means only "where this sits
 * in the order". Completing an item never changes it — the UI decides how to
 * show finished items from `completedAt`, so reopening one returns it to the
 * same spot.
 *
 * Two inserts into the same gap at once can produce equal strings, so readers
 * sort by (position, id) to keep that order stable.
 */

/** Where to put something: first, last, or next to a sibling (by id). */
export type PositionRef = "first" | "last" | { after: string } | { before: string };

function parse(raw: string | undefined, firstWord: string): PositionRef {
  if (!raw || raw === "end") return "last";
  if (raw === firstWord) return "first";
  if (raw.startsWith("after:")) return { after: raw.slice("after:".length) };
  if (raw.startsWith("before:")) return { before: raw.slice("before:".length) };
  throw new Error(`invalid position ref: ${raw}`);
}

/** Item refs: top | end | after:<id> | before:<id>. Missing means end. */
export function parseRef(raw: string | undefined): PositionRef {
  return parse(raw, "top");
}

/** List refs: start | end | after:<id> | before:<id>. Missing means end. */
export function parseProjectRef(raw: string | undefined): PositionRef {
  return parse(raw, "start");
}

/**
 * Resolve a ref against the siblings it is placed among (the thing being
 * moved excluded), sorted by position ASC.
 */
export function resolvePosition(
  siblings: Array<{ id: string; position: string }>,
  ref: PositionRef,
): string {
  if (ref === "first") {
    return generateKeyBetween(null, siblings[0]?.position ?? null);
  }
  if (ref === "last") {
    return generateKeyBetween(siblings.at(-1)?.position ?? null, null);
  }
  const targetId = "after" in ref ? ref.after : ref.before;
  const anchor = siblings.find((s) => s.id === targetId);
  if (!anchor) throw new Error(`position anchor not found: ${targetId}`);
  // There's no key strictly between two equal strings, so when the anchor
  // shares its position with neighbours, place beyond that whole tied run.
  if ("after" in ref) {
    const next = siblings.find((s) => s.position > anchor.position);
    return generateKeyBetween(anchor.position, next?.position ?? null);
  }
  const prev = siblings.findLast((s) => s.position < anchor.position);
  return generateKeyBetween(prev?.position ?? null, anchor.position);
}
