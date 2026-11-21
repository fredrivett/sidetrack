// @vitest-environment jsdom
import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import {
  completeItemAction,
  deleteItemAction,
  setItemParentAction,
  updateItemAction,
} from "@/app/actions";
import type { AgentSession, Item } from "@/core/schema";
import { isReplaySafe } from "@/lib/replayPrivacy";
import { AgentSessionsProvider } from "./agent-sessions";
import { ItemRow } from "./ItemRow";

// The server actions pull in server-only modules (next/cache, the DB); the menu
// render only needs them to exist as callable stubs.
vi.mock("@/app/actions", () => ({
  completeItemAction: vi.fn(),
  uncompleteItemAction: vi.fn(),
  deleteItemAction: vi.fn(),
  updateItemAction: vi.fn(),
  setItemParentAction: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() }),
}));

// The sessions provider refreshes the board through the router.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: vi.fn() }),
}));

// Whether the emulated device has a hover-capable pointer; the item menu opens
// on right-click only there. Reset to a mouse device after each test.
let canHover = true;

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: query === "(hover: hover)" && canHover,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
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

afterEach(() => {
  cleanup();
  canHover = true;
});

const item: Item = {
  id: "i1",
  projectId: "p1",
  title: "Write docs",
  description: null,
  labels: [],
  assigneeIds: [],
  createdBy: null,
  parentId: null,
  collapsed: false,
  dueDate: null,
  dueFrom: null,
  repeatEvery: null,
  repeatUnit: null,
  repeatOn: null,
  repeatDay: null,
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
  canEdit: true,
};

const alex = {
  userId: "u2",
  username: null,
  displayUsername: null,
  name: "Alex",
  email: "alex@example.com",
  image: null,
  isOwner: false,
  canEdit: true,
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
          onOpenDetail={onOpenDetail}
        />
      </SortableContext>
    </DndContext>,
  );
}

describe("ItemRow menu", () => {
  it("opens on right-click without crashing and shows the item ref + Copy ID", () => {
    const { container } = renderRow();
    fireEvent.contextMenu(container.querySelector(".group") as HTMLElement);

    // The ref label and Copy ID render inside the open menu. Before the
    // DropdownMenuGroup wrapper, base-ui's GroupLabel threw here
    // ("MenuGroupContext is missing"), tripping the route error boundary the
    // moment the menu opened.
    expect(screen.getByText("ENG-42")).toBeTruthy();
    expect(screen.getByText("Copy ID")).toBeTruthy();
  });

  it("does not open on touch devices", () => {
    canHover = false;
    const { container } = renderRow();
    fireEvent.contextMenu(container.querySelector(".group") as HTMLElement);
    expect(screen.queryByText("Copy ID")).toBeNull();
  });
});

describe("ItemRow description", () => {
  it("marks an item that has a description, not a blank one", () => {
    renderRow([viewer], { ...item, description: "Steps to reproduce" });
    expect(screen.getByRole("img", { name: "Has description" })).toBeTruthy();
    cleanup();
    renderRow([viewer], { ...item, description: "  \n" });
    expect(screen.queryByRole("img", { name: "Has description" })).toBeNull();
  });
});

describe("ItemRow agents", () => {
  it("names a working agent on the assign trigger of an unassigned item", () => {
    const now = Date.now();
    const session: AgentSession = {
      id: "s1",
      itemId: item.id,
      userId: "u1",
      agentKeyId: "k1",
      agentName: "Amp",
      threadUrl: null,
      branch: "eng-42-write-docs",
      note: null,
      startedAt: now,
      lastActiveAt: now,
      finishedAt: null,
    };
    render(
      <AgentSessionsProvider sessions={[session]} viewerId={session.userId}>
        <ItemRow
          item={item}
          prefix="ENG"
          assignees={[viewer]}
          viewerId="u1"
          prLinks={[]}
          onOpenDetail={() => {}}
        />
      </AgentSessionsProvider>,
    );
    expect(screen.getByRole("button", { name: "Amp (agent, working) on it. Assign" })).toBeTruthy();
  });
});

describe("ItemRow checklist", () => {
  function renderWith(props: Partial<Parameters<typeof ItemRow>[0]>) {
    const onOpenDetail = vi.fn();
    const { container } = render(
      <ItemRow
        item={item}
        prefix="ENG"
        assignees={[viewer]}
        viewerId="u1"
        prLinks={[]}
        onOpenDetail={onOpenDetail}
        {...props}
      />,
    );
    return { row: container.querySelector(".group") as HTMLElement, onOpenDetail };
  }

  it("nests under the item above, or moves out of its parent, from the menu", () => {
    vi.mocked(setItemParentAction).mockClear();
    const above = renderWith({ nestUnder: { id: "p1", title: "Tidy up flat" } });
    fireEvent.contextMenu(above.row);
    fireEvent.click(screen.getByText("Sub-item of “Tidy up flat”"));
    expect(setItemParentAction).toHaveBeenLastCalledWith("i1", "p1");
    expect(above.onOpenDetail).not.toHaveBeenCalled();
    cleanup();

    const child = renderWith({ parentTitle: "Tidy up flat" });
    fireEvent.contextMenu(child.row);
    expect(screen.queryByText(/^Sub-item of/)).toBeNull();
    fireEvent.click(screen.getByText("Move out of “Tidy up flat”"));
    expect(setItemParentAction).toHaveBeenLastCalledWith("i1", null);
  });

  it("shows only the app's own words in session replays, never the item's", () => {
    const { row } = renderWith({ nestUnder: { id: "p1", title: "Tidy up flat" } });
    fireEvent.contextMenu(row);
    expect(isReplaySafe(screen.getByText("Delete item"))).toBe(true);
    expect(isReplaySafe(screen.getByText("View item"))).toBe(true);
    // Titles, here or in a menu item, stay masked.
    expect(isReplaySafe(screen.getAllByText(item.title)[0])).toBe(false);
    expect(isReplaySafe(screen.getByText("Sub-item of “Tidy up flat”"))).toBe(false);
  });

  it("says so in a toast when nesting from the menu fails", async () => {
    vi.mocked(setItemParentAction).mockRejectedValueOnce(new Error("Failed to fetch"));
    const { row } = renderWith({ nestUnder: { id: "p1", title: "Tidy up flat" } });
    fireEvent.contextMenu(row);
    await act(async () => {
      fireEvent.click(screen.getByText("Sub-item of “Tidy up flat”"));
    });
    expect(toast.error).toHaveBeenCalledWith(
      `Couldn't move “${item.title}”. Please try again.`,
    );
  });

  it("toggles the checklist from its progress without opening the item", () => {
    const onToggle = vi.fn();
    const { onOpenDetail } = renderWith({
      checklist: { done: 1, total: 3, expanded: true, onToggle },
    });
    fireEvent.click(screen.getByLabelText("Hide checklist, 1 of 3 done"));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onOpenDetail).not.toHaveBeenCalled();
  });
});

describe("ItemRow open-detail", () => {
  it("opens the detail dialog when the row is clicked", () => {
    const onOpenDetail = vi.fn();
    const { container } = renderRow([viewer], item, onOpenDetail);
    const card = container.querySelector(".group") as HTMLElement;

    fireEvent.click(card);
    expect(onOpenDetail).toHaveBeenCalledTimes(1);
  });

  it("does not open the detail dialog when the checkbox is clicked", () => {
    const onOpenDetail = vi.fn();
    renderRow([viewer], item, onOpenDetail);

    fireEvent.click(screen.getByLabelText("Complete"));
    expect(onOpenDetail).not.toHaveBeenCalled();
  });

  it("does not open the detail dialog when a menu item is clicked", () => {
    const onOpenDetail = vi.fn();
    const { container } = renderRow([viewer], item, onOpenDetail);

    fireEvent.contextMenu(container.querySelector(".group") as HTMLElement);
    fireEvent.click(screen.getByText("Delete item"));
    expect(screen.getByText("Confirm delete?")).toBeTruthy();
    expect(onOpenDetail).not.toHaveBeenCalled();
  });

  it("assigns via the avatar picker without opening the detail dialog", () => {
    vi.mocked(updateItemAction).mockClear();
    const onOpenDetail = vi.fn();
    renderRow([viewer], item, onOpenDetail);

    const trigger = screen.getByLabelText("Assign");
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    // Picking an assignee assigns but must not bubble to the row's open-detail.
    fireEvent.click(screen.getByText("Me"));
    expect(updateItemAction).toHaveBeenCalledWith("i1", { addAssigneeIds: ["u1"] });
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
    expect(updateItemAction).toHaveBeenCalledWith("i1", { addAssigneeIds: ["u1"] });
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
    expect(updateItemAction).toHaveBeenCalledWith("i1", { addAssigneeIds: ["u1"] });
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

    const labels = Array.from(
      document.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"]'),
    ).map((el) => el.textContent);
    // Unassigned first (the clear action), then the viewer ahead of Alex.
    expect(labels[0]).toContain("Unassigned");
    expect(labels[1]).toContain("Me");
    expect(labels[2]).toContain("Alex");
    expect(
      screen.getByText("I", { selector: '[data-slot="kbd"]' }),
    ).toBeTruthy();
  });

  it("ticks everyone on a joint item, and 'i' takes just the viewer off", () => {
    vi.mocked(updateItemAction).mockClear();
    const { container } = renderRow([alex, viewer], {
      ...item,
      assigneeIds: ["u1", "u2"],
    });
    fireEvent.pointerEnter(container.querySelector(".group") as HTMLElement);
    fireEvent.keyDown(document, { key: "a" });

    const option = (name: RegExp) => screen.getByRole("menuitemcheckbox", { name });
    expect(option(/Me/).getAttribute("aria-checked")).toBe("true");
    expect(option(/Alex/).getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(document, { key: "i" });
    expect(updateItemAction).toHaveBeenCalledWith("i1", { removeAssigneeIds: ["u1"] });
  });
});

describe("ItemRow joint items", () => {
  it("names everyone assigned, in the list's member order", () => {
    // Stored Alex first; the list's order (owner first) wins on screen.
    renderRow([viewer, alex], { ...item, assigneeIds: ["u2", "u1"] });
    expect(
      screen.getByLabelText("Assigned to Me and Alex. Change assignees"),
    ).toBeTruthy();
  });

  it("builds each change on the last, before the server answers", () => {
    // The server never answers here, so the item's props stay unassigned and
    // every change has to build on the one before.
    vi.mocked(updateItemAction)
      .mockReset()
      .mockReturnValue(new Promise(() => {}));
    renderRow([viewer, alex]);
    const trigger = screen.getByLabelText("Assign");
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);

    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /Alex/ }));
    expect(updateItemAction).toHaveBeenLastCalledWith("i1", { addAssigneeIds: ["u2"] });
    // The picker stays open and shows the tick straight away.
    const alexOption = screen.getByRole("menuitemcheckbox", { name: /Alex/ });
    expect(alexOption.getAttribute("aria-checked")).toBe("true");

    // I from inside the open picker (its menu has focus) adds me alongside Alex.
    fireEvent.keyDown(screen.getByRole("menu"), { key: "i" });
    expect(updateItemAction).toHaveBeenLastCalledWith("i1", { addAssigneeIds: ["u1"] });
    expect(screen.getByLabelText("Assigned to Me and Alex. Change assignees")).toBeTruthy();
    vi.mocked(updateItemAction).mockReset();
  });

  it("leaves I to the right-click menu's own typing", () => {
    vi.mocked(updateItemAction).mockClear();
    const { container } = renderRow([viewer, alex]);
    const card = container.querySelector(".group") as HTMLElement;
    fireEvent.pointerEnter(card);
    fireEvent.contextMenu(card);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "i" });
    expect(updateItemAction).not.toHaveBeenCalled();
  });
});

describe("ItemRow D, X and ⌫ shortcuts", () => {
  it("ticks the hovered item on 'x', and deletes it only on a second ⌫", () => {
    vi.mocked(completeItemAction).mockClear().mockResolvedValue(undefined as never);
    vi.mocked(deleteItemAction).mockClear().mockResolvedValue(undefined as never);
    const { container } = renderRow();
    const card = container.querySelector(".group") as HTMLElement;

    // Not hovered: unarmed.
    fireEvent.keyDown(document, { key: "x" });
    fireEvent.keyDown(document, { key: "Backspace" });
    expect(completeItemAction).not.toHaveBeenCalled();

    fireEvent.pointerEnter(card);
    fireEvent.keyDown(document, { key: "x" });
    expect(completeItemAction).toHaveBeenCalledWith("i1");

    fireEvent.keyDown(document, { key: "Backspace" });
    expect(deleteItemAction).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      expect.stringContaining("Press ⌫ again"),
      expect.anything(),
    );
    // Leaving the card drops the half-made delete.
    fireEvent.pointerLeave(card);
    fireEvent.pointerEnter(card);
    fireEvent.keyDown(document, { key: "Backspace" });
    expect(deleteItemAction).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Backspace" });
    expect(deleteItemAction).toHaveBeenCalledWith("i1");
  });

  it("opens the quick due dates on 'd' while hovered", () => {
    const { container } = renderRow();
    fireEvent.keyDown(document, { key: "d" });
    expect(screen.queryByText("Pick a date…")).toBeNull();
    fireEvent.pointerEnter(container.querySelector(".group") as HTMLElement);
    fireEvent.keyDown(document, { key: "d" });
    expect(screen.getByText("Pick a date…")).toBeTruthy();
    expect(screen.getByText("Tomorrow")).toBeTruthy();
  });
});
