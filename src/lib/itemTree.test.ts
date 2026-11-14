import { describe, expect, it } from "vitest";
import { projectDrop, type TreeRow } from "./itemTree";

// Rows as shown: "A" with sub-items a1 and a2, then B, the milestone M, and C
// with a collapsed checklist.
const task = (id: string, extra: Partial<TreeRow> = {}): TreeRow => ({
  id,
  depth: 0,
  parentId: null,
  isTask: true,
  hasChildren: false,
  ...extra,
});
const sub = (id: string, parentId: string) => task(id, { depth: 1, parentId });
const rows: TreeRow[] = [
  task("A", { hasChildren: true }),
  sub("a1", "A"),
  sub("a2", "A"),
  task("B"),
  task("M", { isTask: false }),
  task("C", { hasChildren: true, collapsed: true }),
];
const drop = (active: string, over: string, dx: number, list = rows) => {
  const p = projectDrop(list, active, over, dx);
  return p && { parentId: p.parentId, position: p.position };
};

describe("projectDrop", () => {
  it("nests a task sideways into the checklist above, after its last sub-item", () => {
    expect(drop("B", "B", 1)).toEqual({ parentId: "A", position: "after:a2" });
    // Without the sideways move it stays at the top level, where it was.
    expect(drop("B", "B", 0)).toEqual({ parentId: null, position: "after:A" });
  });

  it("nests between two sub-items without a sideways move, but never a milestone", () => {
    // Dropped over a2 from below: it lands between a1 and a2.
    expect(drop("B", "a2", 0)).toEqual({ parentId: "A", position: "after:a1" });
    expect(drop("M", "a2", 0)).toBeNull();
    // A task with sub-items can't become one, so it can't land there either.
    expect(drop("C", "a2", 0)).toBeNull();
  });

  it("moves a last sub-item out sideways, to straight after its parent", () => {
    expect(drop("a2", "a2", -1)).toEqual({ parentId: null, position: "after:A" });
    // A middle one is inside the checklist, so it stays nested.
    expect(drop("a1", "a1", -1)).toEqual({ parentId: "A", position: "top" });
  });

  it("only nests under a task, and keeps a parent with sub-items at the top level", () => {
    // Under the milestone M there's nothing to nest into.
    expect(drop("C", "C", 1, rows.filter((r) => r.id !== "B"))).toEqual({
      parentId: null,
      position: "after:M",
    });
    expect(drop("C", "M", 1)).toEqual({ parentId: null, position: "after:B" });
  });

  it("moves a sub-item into another checklist, at the end of a collapsed one", () => {
    expect(drop("a1", "C", 1)).toEqual({ parentId: "C", position: "end" });
    // Dragged up to the top of the list, it leaves the checklist.
    expect(drop("a1", "A", 0)).toEqual({ parentId: null, position: "top" });
  });
});
