// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { rowAfterDelete, stepItemRow } from "./useItemShortcuts";

afterEach(() => {
  document.body.innerHTML = "";
});

/** Lists side by side, each with rows named by list and position: b2 is the
 * second row of list b. */
function board(lists: Record<string, number>) {
  document.body.innerHTML = Object.entries(lists)
    .map(
      ([list, n]) =>
        `<section data-project-id="${list}">${Array.from(
          { length: n },
          (_, i) => `<div data-item-row="${list}${i + 1}"></div>`,
        ).join("")}</section>`,
    )
    .join("");
}
const step = (from: string | null, dir: Parameters<typeof stepItemRow>[1]) =>
  stepItemRow(from, dir)?.dataset.itemRow;

describe("stepItemRow", () => {
  it("moves up and down within a list, stopping at its ends", () => {
    board({ a: 3, b: 3 });
    expect(step("a2", "down")).toBe("a3");
    expect(step("a3", "down")).toBe("a3");
    expect(step("a1", "up")).toBe("a1");
    expect(step("b2", "up")).toBe("b1");
  });

  it("goes to the same place in the next list, or its last item if it's shorter", () => {
    board({ a: 4, b: 3, c: 2 });
    expect(step("a3", "right")).toBe("b3");
    expect(step("b3", "right")).toBe("c2");
    expect(step("c2", "left")).toBe("b2");
    expect(step("c1", "right")).toBe("c1");
    expect(step("a4", "left")).toBe("a4");
  });

  // A long list renders only the rows near its view, each wrapped with its
  // place in the list (useVirtualRows in ItemList).
  it("goes by place in a long list that renders only some of its rows", () => {
    const rendered = (list: string, at: number[]) =>
      `<section data-project-id="${list}">${at
        .map((i) => `<div data-list-index="${i}"><div data-item-row="${list}${i}"></div></div>`)
        .join("")}</section>`;
    document.body.innerHTML = rendered("a", [50, 51, 52]) + rendered("b", [0, 1, 2, 51]);
    expect(step("a51", "left")).toBe("a51");
    expect(step("a51", "right")).toBe("b51");
    expect(step("a51", "down")).toBe("a52");

    // Scrolled elsewhere, b hasn't rendered place 51: its row level with a51.
    document.body.innerHTML = rendered("a", [50, 51, 52]) + rendered("b", [0, 1, 2]);
    const at = (id: string, top: number) =>
      (document.querySelector(`[data-item-row="${id}"]`) as HTMLElement).getBoundingClientRect = () =>
        ({ top, bottom: top + 40 }) as DOMRect;
    at("a51", 50);
    [0, 1, 2].forEach((i) => at(`b${i}`, i * 50));
    expect(step("a51", "right")).toBe("b1");
  });

  it("skips lists without items", () => {
    board({ a: 2, b: 0, c: 2 });
    expect(step("a2", "right")).toBe("c2");
  });

  it("starts on the first row when nothing is selected or it's gone", () => {
    board({ a: 2, b: 2 });
    expect(step(null, "right")).toBe("a1");
    expect(step("gone", "down")).toBe("a1");
  });

  it("treats rows outside any list as one column", () => {
    document.body.innerHTML = `<div data-item-row="x"></div><div data-item-row="y"></div>`;
    expect(step("x", "down")).toBe("y");
    expect(step("x", "right")).toBe("x");
  });
});

describe("rowAfterDelete", () => {
  it("picks the next item down, skipping the deleted item's sub-items", () => {
    document.body.innerHTML = `<section data-project-id="a">
      <div data-item-row="p"></div>
      <div data-item-row="p1" data-parent-id="p"></div>
      <div data-item-row="p2" data-parent-id="p"></div>
      <div data-item-row="q"></div>
    </section><section data-project-id="b"><div data-item-row="r"></div></section>`;
    expect(rowAfterDelete("p")).toBe("q");
    expect(rowAfterDelete("p1")).toBe("p2");
  });

  it("falls back to the item above, and to none in its own list", () => {
    board({ a: 3, b: 1 });
    expect(rowAfterDelete("a3")).toBe("a2");
    expect(rowAfterDelete("b1")).toBeNull();
  });
});
