// @vitest-environment jsdom
import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { updateItemAction } from "@/app/actions";
import type { Item } from "@/core/schema";
import { ItemRow } from "./ItemRow";

// The server actions pull in server-only modules (next/cache, the DB); the menu
// render only needs them to exist as callable stubs.
vi.mock("@/app/actions", () => ({
  completeItemAction: vi.fn(),
  uncompleteItemAction: vi.fn(),
  deleteItemAction: vi.fn(),
  updateItemAction: vi.fn(),
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
  assigneeId: null,
  position: "a0",
  number: 42,
  completedAt: null,
  createdAt: 0,
};

const viewer = {
  userId: "u1",
  username: null,
  displayUsername: null,
  name: "Me",
  email: "me@example.com",
  image: null,
  isOwner: true,
};

const alex = {
  userId: "u2",
  username: null,
  displayUsername: null,
  name: "Alex",
  email: "alex@example.com",
  image: null,
  isOwner: false,
};

function renderRow(
  assignees = [viewer],
  rowItem: Item = item,
  onOpenDetail: () => void = () => {},
) {
  return render(
    <DndContext>
      <SortableContext items={[rowItem.id]}>
        <ItemRow
          item={rowItem}
          prefix="ENG"
          assignees={assignees}
          viewerId="u1"
          prLinks={[]}
          draggable={false}
          onOpenDetail={onOpenDetail}
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

describe("ItemRow open-detail", () => {
  it("opens the detail sheet when the row is clicked", () => {
    const onOpenDetail = vi.fn();
    const { container } = renderRow([viewer], item, onOpenDetail);
    const card = container.querySelector(".group") as HTMLElement;

    fireEvent.click(card);
    expect(onOpenDetail).toHaveBeenCalledTimes(1);
  });

  it("does not open the detail sheet when the checkbox is clicked", () => {
    const onOpenDetail = vi.fn();
    renderRow([viewer], item, onOpenDetail);

    fireEvent.click(screen.getByLabelText("Complete"));
    expect(onOpenDetail).not.toHaveBeenCalled();
  });

  it("does not open the detail sheet when the options menu is clicked", () => {
    const onOpenDetail = vi.fn();
    renderRow([viewer], item, onOpenDetail);

    const trigger = screen.getByLabelText("Item options");
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    expect(onOpenDetail).not.toHaveBeenCalled();
  });

  it("assigns via the avatar picker without opening the detail sheet", () => {
    vi.mocked(updateItemAction).mockClear();
    const onOpenDetail = vi.fn();
    renderRow([viewer], item, onOpenDetail);

    const trigger = screen.getByLabelText("Assign");
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    // Picking an assignee assigns but must not bubble to the row's open-detail.
    fireEvent.click(screen.getByText("Me"));
    expect(updateItemAction).toHaveBeenCalledWith("i1", { assigneeId: "u1" });
    expect(onOpenDetail).not.toHaveBeenCalled();
  });
});

describe("ItemRow copy-ref shortcut", () => {
  it("copies the ref on mod+. only while the card is hovered", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const { container } = renderRow();
    const card = container.querySelector(".group") as HTMLElement;

    // Not hovered: the shortcut is unarmed, so nothing is copied.
    fireEvent.keyDown(document, { key: ".", ctrlKey: true });
    expect(writeText).not.toHaveBeenCalled();

    // Hovered: ⌘./Ctrl+. copies the ref.
    fireEvent.pointerEnter(card);
    fireEvent.keyDown(document, { key: ".", ctrlKey: true });
    expect(writeText).toHaveBeenCalledWith("ENG-42");
  });
});

describe("ItemRow assign shortcuts", () => {
  it("opens the assignee picker on 'a' only while hovered", () => {
    const { container } = renderRow();
    const card = container.querySelector(".group") as HTMLElement;

    // Not hovered: unarmed, picker stays closed.
    fireEvent.keyDown(document, { key: "a" });
    expect(screen.queryByText("Unassigned")).toBeNull();

    // Hovered: 'a' opens the picker, with the viewer ("Me") in the list.
    fireEvent.pointerEnter(card);
    fireEvent.keyDown(document, { key: "a" });
    expect(screen.getByText("Unassigned")).toBeTruthy();
    expect(screen.getByText("Me")).toBeTruthy();
  });

  it("assigns to the viewer on 'i' while hovered", () => {
    vi.mocked(updateItemAction).mockClear();
    const { container } = renderRow();
    const card = container.querySelector(".group") as HTMLElement;

    fireEvent.pointerEnter(card);
    fireEvent.keyDown(document, { key: "i" });
    expect(updateItemAction).toHaveBeenCalledWith("i1", { assigneeId: "u1" });
  });

  it("still assigns on 'i' once the picker is open and hover is lost", () => {
    // Regression: opening the picker drops `hovered` (modal backdrop), and the
    // shortcut used to disarm while open, so the I hint on the "me" row did
    // nothing. It must stay armed via `assignOpen`.
    vi.mocked(updateItemAction).mockClear();
    const { container } = renderRow();
    const card = container.querySelector(".group") as HTMLElement;

    fireEvent.pointerEnter(card);
    fireEvent.keyDown(document, { key: "a" }); // open the picker
    expect(screen.getByText("Me")).toBeTruthy();
    fireEvent.pointerLeave(card); // backdrop swallows the pointer
    fireEvent.keyDown(document, { key: "i" });
    expect(updateItemAction).toHaveBeenCalledWith("i1", { assigneeId: "u1" });
  });

  it("does not bind 'i' when the viewer can't be assigned", () => {
    vi.mocked(updateItemAction).mockClear();
    const { container } = renderRow([]); // viewer not a candidate
    const card = container.querySelector(".group") as HTMLElement;

    fireEvent.pointerEnter(card);
    fireEvent.keyDown(document, { key: "i" });
    expect(updateItemAction).not.toHaveBeenCalled();
  });

  it("lists the viewer first with the 'I' hint", () => {
    // Viewer passed last to prove the picker sorts them to the top.
    const { container } = renderRow([alex, viewer]);
    fireEvent.pointerEnter(container.querySelector(".group") as HTMLElement);
    fireEvent.keyDown(document, { key: "a" });

    const labels = screen.getAllByRole("menuitem").map((el) => el.textContent);
    // Unassigned first (the clear action), then the viewer ahead of Alex.
    expect(labels[0]).toContain("Unassigned");
    expect(labels[1]).toContain("Me");
    expect(labels[2]).toContain("Alex");
    expect(
      screen.getByText("I", { selector: '[data-slot="kbd"]' }),
    ).toBeTruthy();
  });

  it("marks the viewer with a check (and no hint) when already assigned", () => {
    const { container } = renderRow([alex, viewer], {
      ...item,
      assigneeId: "u1",
    });
    fireEvent.pointerEnter(container.querySelector(".group") as HTMLElement);
    fireEvent.keyDown(document, { key: "a" });

    // The current-selection check takes the row's trailing slot, not the hint.
    expect(
      screen.queryByText("I", { selector: '[data-slot="kbd"]' }),
    ).toBeNull();
  });
});
