// @vitest-environment jsdom
import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Item } from "@/core/schema";
import { ItemRow } from "./ItemRow";

// The server actions pull in server-only modules (next/cache, the DB); the menu
// render only needs them to exist as callable stubs.
vi.mock("@/app/actions", () => ({
  completeItemAction: vi.fn(),
  uncompleteItemAction: vi.fn(),
  deleteItemAction: vi.fn(),
}));

beforeAll(() => {
  // base-ui's menu positioning observes resize; jsdom has no ResizeObserver, so
  // stub it with inert methods (jsdom never lays out, so nothing to observe).
  globalThis.ResizeObserver ??= class {
    observe() {
      return undefined;
    }
    unobserve() {
      return undefined;
    }
    disconnect() {
      return undefined;
    }
  };
});

afterEach(cleanup);

const item: Item = {
  id: "i1",
  projectId: "p1",
  kind: "task",
  title: "Write docs",
  description: null,
  category: null,
  position: "a0",
  number: 42,
  completedAt: null,
  createdAt: 0,
};

function renderRow() {
  return render(
    <DndContext>
      <SortableContext items={[item.id]}>
        <ItemRow
          item={item}
          prefix="ENG"
          prLinks={[]}
          draggable={false}
          onOpenDetail={() => {}}
        />
      </SortableContext>
    </DndContext>,
  );
}

describe("ItemRow menu", () => {
  it("opens without crashing and shows the item ref + Copy ID", () => {
    renderRow();
    const trigger = screen.getByLabelText("Item options");
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);

    // The ref label and Copy ID render inside the open menu. Before the
    // DropdownMenuGroup wrapper, base-ui's GroupLabel threw here
    // ("MenuGroupContext is missing"), tripping the route error boundary the
    // moment the menu opened.
    expect(screen.getByText("ENG-42")).toBeTruthy();
    expect(screen.getByText("Copy ID")).toBeTruthy();
  });
});
