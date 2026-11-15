/**
 * Group a flat, position-ordered list of items into top-level items, each with
 * its sub-items (in order). A sub-item whose parent isn't in the list (say, the
 * parent was filtered out) is kept at the top level rather than dropped.
 */
export function nestItems<T extends { id: string; parentId: string | null }>(
  list: T[],
): Array<T & { children: T[] }> {
  const ids = new Set(list.map((i) => i.id));
  const children = new Map<string, T[]>();
  for (const it of list) {
    if (it.parentId && ids.has(it.parentId)) {
      const siblings = children.get(it.parentId);
      if (siblings) siblings.push(it);
      else children.set(it.parentId, [it]);
    }
  }
  return list
    .filter((it) => !it.parentId || !ids.has(it.parentId))
    .map((it) => ({ ...it, children: children.get(it.id) ?? [] }));
}

/** A row of a list as shown: a top-level item, or a sub-item under its parent. */
export type TreeRow = {
  id: string;
  /** 0 for a top-level row, 1 for a sub-item. */
  depth: number;
  /** The parent the row shows under; null at the top level. */
  parentId: string | null;
  /** An item with sub-items can't become one. */
  hasChildren: boolean;
  /** A parent whose sub-items are hidden, so they aren't rows. */
  collapsed?: boolean;
};

/** Where a dragged row would land, and the depths it could take there. */
export type DropTarget = {
  depth: number;
  minDepth: number;
  maxDepth: number;
  /** The new parent; null for the top level. */
  parentId: string | null;
  /** Its position among its new siblings: top | end | after:<id>. */
  position: string;
};

/**
 * Where `activeId` lands when dropped over `overId` after moving `depthDelta`
 * indents sideways. The depth starts at the row's own and is clamped to what
 * the spot allows: one level deep, and only rows without sub-items of their own.
 * A spot between two sub-items is inside that checklist, so there it must nest;
 * a row that can't (one with sub-items) can't land there, and that's null. `rows` are in the order shown, without the dragged row's own
 * sub-items, which move with it.
 */
export function projectDrop(
  rows: TreeRow[],
  activeId: string,
  overId: string,
  depthDelta: number,
): DropTarget | null {
  const activeIndex = rows.findIndex((r) => r.id === activeId);
  const overIndex = rows.findIndex((r) => r.id === overId);
  if (activeIndex === -1 || overIndex === -1) return null;
  const active = rows[activeIndex];
  // The order as it would be after the drop.
  const moved = rows.filter((r) => r.id !== activeId);
  moved.splice(overIndex, 0, active);
  const prev = moved[overIndex - 1];
  const next = moved[overIndex + 1];

  const canNest = !active.hasChildren && prev !== undefined;
  const maxDepth = canNest ? 1 : 0;
  const minDepth = next?.depth === 1 ? 1 : 0;
  if (minDepth > maxDepth) return null;
  const depth = Math.min(maxDepth, Math.max(minDepth, active.depth + depthDelta));

  const parentId = depth === 0 ? null : prev.depth === 0 ? prev.id : prev.parentId;
  // After the nearest sibling above, or first among them; nesting under a
  // collapsed parent appends, since its sub-items aren't in view.
  let position = "top";
  for (let i = overIndex - 1; i >= 0; i--) {
    const r = moved[i];
    if (r.id === parentId) {
      if (r.collapsed) position = "end";
      break;
    }
    if (r.depth === depth && r.parentId === parentId) {
      position = `after:${r.id}`;
      break;
    }
  }
  return { depth, minDepth, maxDepth, parentId, position };
}
