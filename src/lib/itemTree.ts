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
      children.set(it.parentId, [...(children.get(it.parentId) ?? []), it]);
    }
  }
  return list
    .filter((it) => !it.parentId || !ids.has(it.parentId))
    .map((it) => ({ ...it, children: children.get(it.id) ?? [] }));
}
