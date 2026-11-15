// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

function renderSheet(
  open = true,
  checklist: Item[] = [],
  nestTargets: Item[] = [],
  patch: Partial<Item> = {},
) {
  return render(
    <ItemDetailSheet
      item={{ ...item, ...patch }}
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

describe("ItemDetailSheet due date picker", () => {
  beforeEach(() => {
    vi.mocked(updateItemAction).mockClear();
    // 1am on Wednesday the 18th: the app's day is still Tuesday the 17th.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 18, 1));
  });
  afterEach(() => vi.useRealTimers());

  function openPicker() {
    const trigger = screen.getByRole("button", { name: "Pick date" });
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    return screen.getByLabelText("Type a due date");
  }

  // Key by key, so the sheet's bare-key shortcuts see every keystroke.
  function type(input: HTMLElement, text: string) {
    for (let i = 1; i <= text.length; i++) {
      fireEvent.keyDown(input, { key: text[i - 1] });
      fireEvent.change(input, { target: { value: text.slice(0, i) } });
    }
  }

  it("saves a typed day on Enter, counted from the app's day", () => {
    renderSheet();
    const input = openPicker();
    // "a" and "i" are the sheet's assign shortcuts; typing them must not assign.
    type(input, "in 2 days");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(updateItemAction).toHaveBeenCalledTimes(1);
    expect(updateItemAction).toHaveBeenCalledWith("i1", { dueDate: "2026-11-19" });
    expect(screen.queryByRole("menuitem", { name: /Unassigned/ })).toBeNull();
    expect(screen.queryByLabelText("Type a due date")).toBeNull();
  });

  it("saves nothing on Enter when the text isn't a date", () => {
    renderSheet();
    const input = openPicker();
    type(input, "blah");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("Not a date")).toBeTruthy();
    expect(updateItemAction).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Type a due date")).toBeTruthy();
  });

  it("saves a clicked day, but not the day already set", () => {
    renderSheet(true, [], [], { dueDate: "2026-11-27" });
    openPicker();
    fireEvent.click(screen.getByRole("button", { name: /November 27th, 2026, selected/ }));
    expect(updateItemAction).not.toHaveBeenCalled();
    openPicker();
    fireEvent.click(screen.getByRole("button", { name: "Monday, November 30th, 2026" }));
    expect(updateItemAction).toHaveBeenCalledWith("i1", { dueDate: "2026-11-30" });
  });
});
