import { describe, expect, it } from "vitest";
import { maskReplayAttributes } from "./replayPrivacy";

describe("maskReplayAttributes", () => {
  it("masks content attributes in snapshots, added nodes and attribute changes, and keeps the rest", () => {
    // A full snapshot (type 2) and a mutation (type 3, source 0), as rrweb records them.
    const button = {
      type: 2,
      tagName: "button",
      attributes: { "aria-label": "Complete Buy milk", class: "row", "aria-pressed": "true" },
      childNodes: [{ type: 3, textContent: "Buy milk" }],
    };
    const added = { type: 2, tagName: "a", attributes: { href: "https://acme.dev/x", rel: "noreferrer" } };
    const changed = { id: 7, attributes: { title: "Due Fri 2", style: { color: "red" }, "data-state": "open" } };
    const events = [
      {
        type: 2,
        data: {
          node: {
            type: 0,
            childNodes: [button],
          },
        },
      },
      {
        type: 3,
        data: {
          source: 0,
          adds: [{ parentId: 1, node: added }],
          attributes: [changed],
        },
      },
    ];

    maskReplayAttributes(events);

    expect(button.attributes).toEqual({
      "aria-label": "******** *** ****",
      class: "row",
      "aria-pressed": "true",
    });
    expect(added.attributes).toEqual({ href: "******************", rel: "noreferrer" });
    expect(changed.attributes).toEqual({
      title: "*** *** *",
      style: { color: "red" },
      "data-state": "open",
    });
    // Text is rrweb's to mask (maskTextSelector), not this.
    expect(button.childNodes[0]).toEqual({ type: 3, textContent: "Buy milk" });
  });
});
