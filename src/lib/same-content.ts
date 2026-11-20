/**
 * Whether two values hold the same thing: equal, or arrays and plain objects
 * (an item, its links, its people) whose entries are, `depth` levels down.
 * Functions and other objects must be the same one. For keeping what the
 * server sent again unchanged, so what shows it needn't re-render.
 */
export function sameContent(a: unknown, b: unknown, depth: number): boolean {
  if (Object.is(a, b)) return true;
  if (depth === 0 || typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a)) {
    return (
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => sameContent(v, b[i], depth - 1))
    );
  }
  const plain = (o: object) => [Object.prototype, null].includes(Object.getPrototypeOf(o));
  if (Array.isArray(b) || !plain(a) || !plain(b)) return false;
  const ka = Object.keys(a);
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  return (
    ka.length === Object.keys(b).length &&
    ka.every((k) => k in rb && sameContent(ra[k], rb[k], depth - 1))
  );
}
