// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { setItemParentAction, updateItemAction } from "@/app/actions";
import type { Item } from "@/core/schema";
import { ItemDetailSheet } from "./ItemDetailSheet";

// Server actions pull in server-only modules; the sheet only needs callable stubs.
vi.mock("@/app/actions", () => ({
  completeItemAction: vi.fn(),
  uncompleteItemAction: vi.fn(),
  deleteItemAction: vi.fn(),
  updateItemAction: vi.fn(),
  setItemParentAction: vi.fn(),
}));

beforeAll(() => {
  // base-ui's dialog/menu positioning observes resize; jsdom has neither
  // ResizeObserver nor matchMedia (the sheet's desktop/mobile switch), so stub
  // both with inert implementations.
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
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() {
      return false;
    },
  })) as typeof window.matchMedia;
});

afterEach(cleanup);

const item: Item = {
  id: "i1",
  projectId: "p1",
  title: "Write docs",
  description: null,
  category: null,
  assigneeId: null,
  parentId: null,
  dueDate: null,
  repeatEvery: null,
  repeatUnit: null,
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

function renderSheet(open = true, checklist: Item[] = [], nestTargets: Item[] = []) {
  return render(
    <ItemDetailSheet
      item={item}
      parent={null}
      checklist={checklist}
      nestTargets={nestTargets}
      onOpenItem={() => {}}
      prefix="ENG"
      assignees={[viewer]}
      viewerId="u1"
      prLinks={[]}
      open={open}
      onOpenChange={() => {}}
    />,
  );
}

describe("ItemDetailSheet assign shortcuts", () => {
  it("opens the assignee picker on 'a' while the sheet is open", () => {
    renderSheet();
    // The sheet owns the shortcut (it IS the dialog, so it doesn't defer).
    // "Unassigned" also labels the field trigger, so scope to the menu items.
    fireEvent.keyDown(document, { key: "a" });
    expect(screen.getByRole("menuitem", { name: /Unassigned/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Me/ })).toBeTruthy();
  });

  it("assigns to the viewer on 'i'", () => {
    vi.mocked(updateItemAction).mockClear();
    renderSheet();
    fireEvent.keyDown(document, { key: "i" });
    expect(updateItemAction).toHaveBeenCalledWith("i1", { assigneeId: "u1" });
  });

  it("still assigns to the viewer on 'i' while the picker is open", () => {
    // Regression: the shortcut used to disarm itself while the picker was open,
    // so the I hint shown on the "me" row did nothing.
    vi.mocked(updateItemAction).mockClear();
    renderSheet();
    fireEvent.keyDown(document, { key: "a" }); // open the picker
    expect(screen.getByRole("menuitem", { name: /Me/ })).toBeTruthy();
    fireEvent.keyDown(document, { key: "i" });
    expect(updateItemAction).toHaveBeenCalledWith("i1", { assigneeId: "u1" });
  });

  it("assigns the sub-item, not this item, on 'i' while its checklist picker is open", () => {
    vi.mocked(updateItemAction).mockClear();
    const child: Item = { ...item, id: "c1", title: "Lorna", parentId: "i1", number: 43 };
    renderSheet(true, [child]);
    const trigger = screen.getByLabelText("Assign Lorna");
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    expect(screen.getByRole("menuitem", { name: /Me/ })).toBeTruthy();
    fireEvent.keyDown(document, { key: "i" });
    expect(updateItemAction).toHaveBeenCalledTimes(1);
    expect(updateItemAction).toHaveBeenCalledWith("c1", { assigneeId: "u1" });
  });

  it("does not act on shortcuts while the sheet is closed", () => {
    vi.mocked(updateItemAction).mockClear();
    renderSheet(false);
    fireEvent.keyDown(document, { key: "a" });
    fireEvent.keyDown(document, { key: "i" });
    expect(screen.queryByRole("menuitem", { name: /Unassigned/ })).toBeNull();
    expect(updateItemAction).not.toHaveBeenCalled();
  });
});

describe("ItemDetailSheet nesting", () => {
  const other: Item = { ...item, id: "i2", title: "Tidy up flat", number: 7 };

  it("makes a plain task a sub-item of the task picked", () => {
    renderSheet(true, [], [other]);
    const trigger = screen.getByRole("button", { name: /make it a sub-item of/ });
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "Tidy up flat" }));
    expect(setItemParentAction).toHaveBeenCalledWith("i1", "i2");
  });

  it("isn't offered for a task with sub-items, which can't become one", () => {
    const child: Item = { ...item, id: "c1", title: "Lounge", parentId: "i1", number: 43 };
    renderSheet(true, [child], [other]);
    expect(screen.queryByRole("button", { name: /make it a sub-item of/ })).toBeNull();
  });
});
