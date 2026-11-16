// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { addItemAction, setItemParentAction, updateItemAction } from "@/app/actions";
import type { Item } from "@/core/schema";
import { ItemDetailDialog } from "./ItemDetailDialog";

// Server actions pull in server-only modules; the dialog only needs callable stubs.
vi.mock("@/app/actions", () => ({
  addItemAction: vi.fn(),
  listAuditAction: vi.fn(),
  listCommentsAction: vi.fn(async () => []),
  addCommentAction: vi.fn(),
  updateCommentAction: vi.fn(),
  deleteCommentAction: vi.fn(),
  completeItemAction: vi.fn(),
  uncompleteItemAction: vi.fn(),
  deleteItemAction: vi.fn(),
  updateItemAction: vi.fn(),
  setItemParentAction: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

beforeAll(() => {
  // base-ui's dialog/menu positioning observes resize; jsdom has neither
  // ResizeObserver nor matchMedia (the dialog's desktop/mobile switch), so stub
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
  labels: [],
  assigneeIds: [],
  parentId: null,
  collapsed: false,
  dueDate: null,
  dueFrom: null,
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

function renderDialog(
  open = true,
  checklist: Item[] = [],
  nestTargets: Item[] = [],
  patch: Partial<Item> = {},
) {
  const dialog = (checklist: Item[]) => (
    <ItemDetailDialog
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
    />
  );
  const view = render(dialog(checklist));
  /** Re-renders with a new checklist, as a refresh from the server does. */
  return { ...view, refresh: (next: Item[]) => view.rerender(dialog(next)) };
}

describe("ItemDetailDialog assign shortcuts", () => {
  it("opens the assignee picker on 'a' while the dialog is open", () => {
    renderDialog();
    // The dialog owns the shortcut (it is the [role=dialog], so it doesn't defer).
    // "Unassigned" also labels the field trigger, so scope to the menu items.
    fireEvent.keyDown(document, { key: "a" });
    expect(screen.getByRole("menuitem", { name: /Unassigned/ })).toBeTruthy();
    expect(screen.getByRole("menuitemcheckbox", { name: /Me/ })).toBeTruthy();
  });

  it("assigns to the viewer on 'i'", () => {
    vi.mocked(updateItemAction).mockClear();
    renderDialog();
    fireEvent.keyDown(document, { key: "i" });
    expect(updateItemAction).toHaveBeenCalledWith("i1", { addAssigneeIds: ["u1"] });
  });

  it("says so in a toast when assigning fails, and keeps the dialog up", async () => {
    vi.mocked(updateItemAction).mockRejectedValueOnce(new Error("Failed to fetch"));
    renderDialog();
    await act(async () => {
      fireEvent.keyDown(document, { key: "i" });
    });
    expect(toast.error).toHaveBeenCalledWith(
      "Couldn't change who's assigned. Please try again.",
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("still assigns to the viewer on 'i' while the picker is open", () => {
    // Regression: the shortcut used to disarm itself while the picker was open,
    // so the I hint shown on the "me" row did nothing.
    vi.mocked(updateItemAction).mockClear();
    renderDialog();
    fireEvent.keyDown(document, { key: "a" }); // open the picker
    expect(screen.getByRole("menuitemcheckbox", { name: /Me/ })).toBeTruthy();
    fireEvent.keyDown(document, { key: "i" });
    expect(updateItemAction).toHaveBeenCalledWith("i1", { addAssigneeIds: ["u1"] });
  });

  it("assigns the sub-item, not this item, on 'i' while its checklist picker is open", () => {
    vi.mocked(updateItemAction).mockClear();
    const child: Item = { ...item, id: "c1", title: "Lorna", parentId: "i1", number: 43 };
    renderDialog(true, [child]);
    const trigger = screen.getByLabelText("Assign Lorna");
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    expect(screen.getByRole("menuitemcheckbox", { name: /Me/ })).toBeTruthy();
    fireEvent.keyDown(document, { key: "i" });
    expect(updateItemAction).toHaveBeenCalledTimes(1);
    expect(updateItemAction).toHaveBeenCalledWith("c1", { addAssigneeIds: ["u1"] });
  });

  it("does not act on shortcuts while the dialog is closed", () => {
    vi.mocked(updateItemAction).mockClear();
    renderDialog(false);
    fireEvent.keyDown(document, { key: "a" });
    fireEvent.keyDown(document, { key: "i" });
    expect(screen.queryByRole("menuitem", { name: /Unassigned/ })).toBeNull();
    expect(updateItemAction).not.toHaveBeenCalled();
  });
});

describe("ItemDetailDialog nesting", () => {
  const other: Item = { ...item, id: "i2", title: "Tidy up flat", number: 7 };

  it("makes a plain task a sub-item of the task picked", () => {
    renderDialog(true, [], [other]);
    const trigger = screen.getByRole("button", { name: /make it a sub-item of/ });
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "Tidy up flat" }));
    expect(setItemParentAction).toHaveBeenCalledWith("i1", "i2");
  });

  it("isn't offered for a task with sub-items, which can't become one", () => {
    const child: Item = { ...item, id: "c1", title: "Lounge", parentId: "i1", number: 43 };
    renderDialog(true, [child], [other]);
    expect(screen.queryByRole("button", { name: /make it a sub-item of/ })).toBeNull();
  });
});

describe("ItemDetailDialog checklist", () => {
  it("keeps the task's title out of the add input's label", () => {
    // Regression: Safari reads the label to guess what a field holds, and
    // labelling it with "Change phone plan" got it phone-number AutoFill.
    renderDialog(true, [], [], { title: "Change phone plan" });
    const input = screen.getByPlaceholderText("Add a step…");
    expect(input.getAttribute("aria-label")).not.toMatch(/phone/i);
  });
});

describe("ItemDetailDialog due date picker", () => {
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

  // Key by key, so the dialog's bare-key shortcuts see every keystroke.
  function type(input: HTMLElement, text: string) {
    for (let i = 1; i <= text.length; i++) {
      fireEvent.keyDown(input, { key: text[i - 1] });
      fireEvent.change(input, { target: { value: text.slice(0, i) } });
    }
  }

  it("saves a typed day on Enter, counted from the app's day", () => {
    renderDialog();
    const input = openPicker();
    // "a" and "i" are the dialog's assign shortcuts; typing them must not assign.
    type(input, "in 2 days");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(updateItemAction).toHaveBeenCalledTimes(1);
    expect(updateItemAction).toHaveBeenCalledWith("i1", { dueFrom: null, dueDate: "2026-11-19" });
    expect(screen.queryByRole("menuitem", { name: /Unassigned/ })).toBeNull();
    expect(screen.queryByLabelText("Type a due date")).toBeNull();
  });

  it("saves a typed week as the span Monday to Sunday", () => {
    renderDialog();
    type(openPicker(), "next week");
    fireEvent.keyDown(screen.getByLabelText("Type a due date"), { key: "Enter" });
    expect(updateItemAction).toHaveBeenCalledWith("i1", {
      dueFrom: "2026-11-23",
      dueDate: "2026-11-29",
    });
  });

  it("saves nothing on Enter when the text isn't a date", () => {
    renderDialog();
    const input = openPicker();
    type(input, "blah");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("Not a date")).toBeTruthy();
    expect(updateItemAction).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Type a due date")).toBeTruthy();
  });

  it("moves focus between days with the arrow keys", () => {
    renderDialog(true, [], [], { dueDate: "2026-11-27" });
    openPicker();
    const selected = screen.getByRole("button", { name: /November 27th, 2026, selected/ });
    selected.focus();
    fireEvent.focus(selected);
    fireEvent.keyDown(selected, { key: "ArrowRight" });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Saturday, November 28th, 2026" }),
    );
  });

  it("saves a clicked day, but not the day already set", () => {
    renderDialog(true, [], [], { dueDate: "2026-11-27" });
    openPicker();
    fireEvent.click(screen.getByRole("button", { name: /November 27th, 2026, selected/ }));
    expect(updateItemAction).not.toHaveBeenCalled();
    openPicker();
    fireEvent.click(screen.getByRole("button", { name: "Monday, November 30th, 2026" }));
    expect(updateItemAction).toHaveBeenCalledWith("i1", { dueFrom: null, dueDate: "2026-11-30" });
  });
});

describe("ItemDetailDialog checklist", () => {
  it("shows a new line at once while it saves, and puts it back in the input if it fails", async () => {
    let fail!: () => void;
    vi.mocked(addItemAction).mockReturnValueOnce(
      new Promise((_, reject) => (fail = () => reject(new Error("Failed to fetch")))),
    );
    renderDialog();
    const input = screen.getByRole("textbox", { name: "Add a sub-item" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Buy bread" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // Before the server answers: the line shows, marked as saving.
    await act(async () => {});
    expect(input.value).toBe("");
    expect(screen.getByText("Buy bread").closest("[aria-busy]")).toBeTruthy();

    await act(async () => fail());
    expect(screen.queryByText("Buy bread")).toBeNull();
    expect(input.value).toBe("Buy bread");
    expect(toast.error).toHaveBeenCalledWith("Couldn't add “Buy bread”. Please try again.");
  });

  it("shows a saved line once when it arrives while the next line still saves", async () => {
    let finishSecond!: () => void;
    vi.mocked(addItemAction)
      .mockResolvedValueOnce(undefined as never)
      .mockReturnValueOnce(new Promise((resolve) => (finishSecond = () => resolve(undefined as never))));
    const { refresh } = renderDialog();
    const input = screen.getByRole("textbox", { name: "Add a sub-item" });
    // The same title twice: each saved sub-item stands for one line.
    for (const title of ["One", "One"]) {
      fireEvent.change(input, { target: { value: title } });
      fireEvent.keyDown(input, { key: "Enter" });
    }
    await act(async () => {});

    // The first line comes back from the server while the second is saving.
    const one = { ...item, id: "c1", title: "One", parentId: "i1", number: 43 };
    refresh([one]);
    const lines = screen.getAllByText("One");
    expect(lines).toHaveLength(2);
    expect(lines.filter((l) => l.closest("[aria-busy]"))).toHaveLength(1);
    await act(async () => finishSecond());
  });
});
