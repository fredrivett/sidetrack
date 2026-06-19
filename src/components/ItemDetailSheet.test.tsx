// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { updateItemAction } from "@/app/actions";
import type { Item } from "@/core/schema";
import { ItemDetailSheet } from "./ItemDetailSheet";

// Server actions pull in server-only modules; the sheet only needs callable stubs.
vi.mock("@/app/actions", () => ({
  completeItemAction: vi.fn(),
  uncompleteItemAction: vi.fn(),
  deleteItemAction: vi.fn(),
  updateItemAction: vi.fn(),
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

function renderSheet(open = true) {
  return render(
    <ItemDetailSheet
      item={item}
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

  it("does not act on shortcuts while the sheet is closed", () => {
    vi.mocked(updateItemAction).mockClear();
    renderSheet(false);
    fireEvent.keyDown(document, { key: "a" });
    fireEvent.keyDown(document, { key: "i" });
    expect(screen.queryByRole("menuitem", { name: /Unassigned/ })).toBeNull();
    expect(updateItemAction).not.toHaveBeenCalled();
  });
});
