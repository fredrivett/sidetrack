// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { addItemAction } from "@/app/actions";
import type { Item } from "@/core/schema";
import type { ProjectView } from "./Kanban";
import type { AssigneeView } from "@/core/members";
import { aiRead } from "./ai-read";
import { NewItemDialog } from "./NewItemDialog";

vi.mock("@/app/actions", () => ({
  addItemAction: vi.fn(async (input: { title: string }) => ({ id: "new", projectId: "p1", title: input.title })),
  createProjectAction: vi.fn(),
}));
// Jev's suggestions never arrive here.
vi.mock("./ai-read", () => ({ aiRead: vi.fn(() => new Promise(() => {})) }));

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 14, 12));
  // Reduced motion: the dialog's views swap without animating, which jsdom can't.
  window.matchMedia = ((query: string) => ({
    matches: query.includes("reduced-motion"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  Element.prototype.scrollIntoView = vi.fn();
  // The dialog's views observe their height as they swap; jsdom has no ResizeObserver.
  globalThis.ResizeObserver ??= class {
    observe() {
      return undefined;
    }
    disconnect() {
      return undefined;
    }
  } as unknown as typeof ResizeObserver;
});
afterAll(() => vi.useRealTimers());
afterEach(() => {
  cleanup();
  localStorage.clear();
});

const home = { id: "p1", name: "Home", refPrefix: "HOM", icon: null, status: "active" } as unknown as ProjectView;

const person = (userId: string, name: string): AssigneeView => ({
  userId,
  name,
  username: name.toLowerCase(),
  displayUsername: null,
  email: null,
  image: null,
  isOwner: userId === "me",
  canEdit: true,
});
const me = person("me", "Fred");
const bob = person("bob", "Bob");

const dialog = (dueToday?: boolean, open = true, people: AssigneeView[] = []) => (
  <NewItemDialog
    open={open}
    onOpenChange={() => {}}
    onOpenItem={() => {}}
    findItem={() => undefined}
    renderItem={() => null}
    projects={[home]}
    assigneesByProject={{ p1: people }}
    viewerId="me"
    initialProjectId="p1"
    dueToday={dueToday}
    shownOnBoard={() => true}
  />
);

describe("NewItemDialog", () => {
  it("opens due today from the Brief's +, and keeps today for the next item", async () => {
    // Mounted closed and opened, as the board does.
    const { rerender } = render(dialog(true, false));
    rerender(dialog(true));
    const dueChip = () => screen.getByRole("button", { name: /^Due/ });
    expect(dueChip().textContent).toBe("Due Today");
    // The first item goes tomorrow; the next starts from today again.
    fireEvent.click(dueChip());
    fireEvent.click(screen.getByRole("button", { name: "Tomorrow" }));
    expect(dueChip().textContent).toBe("Due Tomorrow");
    fireEvent.change(screen.getByPlaceholderText("Add a task…"), { target: { value: "Buy milk" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Add & create more/ })));
    expect(vi.mocked(addItemAction)).toHaveBeenLastCalledWith(expect.objectContaining({ dueDate: "2026-11-15" }));
    expect(dueChip().textContent).toBe("Due Today");
    fireEvent.change(screen.getByPlaceholderText("Add a task…"), { target: { value: "Post parcel" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Add & create more/ })));
    expect(vi.mocked(addItemAction)).toHaveBeenLastCalledWith(expect.objectContaining({ dueDate: "2026-11-14" }));
  });

  it("keeps what's typed through a reload, until it's cancelled", () => {
    render(dialog());
    fireEvent.change(screen.getByPlaceholderText("Add a task…"), { target: { value: "Buy milk" } });
    fireEvent.change(screen.getByPlaceholderText("Add description…"), { target: { value: "Oat" } });
    fireEvent.change(screen.getByPlaceholderText("Add a step…"), { target: { value: "Check fridge" } });
    // A reload: the page goes, and comes back with the dialog open.
    cleanup();
    render(dialog());
    expect(screen.getByPlaceholderText<HTMLInputElement>("Add a task…").value).toBe("Buy milk");
    expect(screen.getByPlaceholderText<HTMLTextAreaElement>("Add description…").value).toBe("Oat");
    expect(screen.getByPlaceholderText<HTMLInputElement>("Add a step…").value).toBe("Check fridge");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    cleanup();
    render(dialog());
    expect(screen.getByPlaceholderText<HTMLInputElement>("Add a task…").value).toBe("");
    expect(screen.getByPlaceholderText<HTMLInputElement>("Add a step…").value).toBe("");
  });

  it("adds a line ticked off before the item exists as done, and the rest open", async () => {
    render(dialog());
    fireEvent.change(screen.getByPlaceholderText("Add a task…"), { target: { value: "Pack" } });
    const step = () => screen.getByRole<HTMLInputElement>("textbox", { name: "Add a sub-item" });
    for (const t of ["Toothbrush", "Charger"]) {
      fireEvent.change(step(), { target: { value: t } });
      fireEvent.keyDown(step(), { key: "Enter" });
    }
    fireEvent.click(screen.getByRole("checkbox", { name: "Complete Charger" }));
    expect(screen.getByText("Checklist · 1/2")).toBeTruthy();
    // Typed but not yet entered: it's added too, open.
    fireEvent.change(step(), { target: { value: "Boots" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    });
    expect(
      vi.mocked(addItemAction).mock.lastCall?.[0].subItems?.map(({ title, completed }) => ({ title, completed })),
    ).toEqual([
      { title: "Toothbrush", completed: false },
      { title: "Charger", completed: true },
      { title: "Boots", completed: false },
    ]);
  });

  it("adds a line with what its title and its own view set, not the item's", async () => {
    render(dialog(true, true, [me, bob]));
    fireEvent.change(screen.getByPlaceholderText("Add a task…"), { target: { value: "Trip" } });
    const step = () => screen.getByRole<HTMLInputElement>("textbox", { name: "Add a sub-item" });
    // "@bob" and "#travel" set the line's people and label, and come out of its title.
    fireEvent.change(step(), { target: { value: "Book trains @bob #travel" } });
    fireEvent.keyDown(step(), { key: "Enter" });
    fireEvent.change(step(), { target: { value: "Pack" } });
    fireEvent.keyDown(step(), { key: "Enter" });

    // Opened, the line gets a description and a date of its own.
    fireEvent.click(screen.getByRole("button", { name: /^Book trains/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), {
      target: { value: "Off-peak" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Due/ }));
    fireEvent.click(screen.getByRole("button", { name: "Tomorrow" }));
    fireEvent.click(screen.getByRole("button", { name: "Back to Trip" }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    });
    const input = vi.mocked(addItemAction).mock.lastCall?.[0];
    expect(input?.dueDate).toBe("2026-11-14");
    expect(input?.subItems).toEqual([
      {
        title: "Book trains",
        completed: false,
        description: "Off-peak",
        dueDate: "2026-11-15",
        dueFrom: null,
        repeat: null,
        assigneeIds: ["bob"],
        labels: ["travel"],
      },
      {
        title: "Pack",
        completed: false,
        description: null,
        dueDate: null,
        dueFrom: null,
        repeat: null,
        assigneeIds: [],
        labels: [],
      },
    ]);
  });

  it("keeps what's picked through a reload, until it's cancelled", () => {
    const { rerender } = render(dialog(true, false));
    rerender(dialog(true));
    const dueChip = () => screen.getByRole("button", { name: /^Due/ });
    fireEvent.click(dueChip());
    fireEvent.click(screen.getByRole("button", { name: "Tomorrow" }));
    // The board comes back closed, then reopens New item from this tab's
    // storage: opening mustn't reset what was picked.
    cleanup();
    const again = render(dialog(true, false));
    again.rerender(dialog(true));
    expect(dueChip().textContent).toBe("Due Tomorrow");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    cleanup();
    const fresh = render(dialog(true, false));
    fresh.rerender(dialog(true));
    expect(dueChip().textContent).toBe("Due Today");
  });

  it("opens with no date otherwise", () => {
    const { rerender } = render(dialog(undefined, false));
    rerender(dialog());
    expect(screen.getByRole("button", { name: "Due date" })).toBeTruthy();
  });

  it("fills in Jev's suggestions only where nothing's picked, until they're cleared", async () => {
    vi.mocked(aiRead).mockResolvedValueOnce({
      projectId: "p1",
      duplicate: null,
      parent: null,
      due: "tomorrow",
      repeat: { every: 1, unit: "week" },
      label: null,
      assigneeId: "bob",
      titleParts: [],
    });
    const { rerender } = render(dialog(undefined, false, [me, bob]));
    rerender(dialog(undefined, true, [me, bob]));
    const dueChip = () => screen.getByRole("button", { name: /^Due/ });
    const repeatChip = () => screen.getByRole("button", { name: /Repeat|Weekly/ });
    const assigneeChip = () => screen.getByRole("button", { name: /Unassigned|Bob/ });
    // Picked before Jev answers, so Jev's date mustn't replace it.
    fireEvent.click(dueChip());
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    fireEvent.change(screen.getByPlaceholderText("Add a task…"), { target: { value: "Bins out" } });
    await act(() => new Promise((r) => setTimeout(r, 500)));
    expect(dueChip().textContent).toBe("Due Today");
    expect(repeatChip().title).toBe("Suggested by Jev");
    expect(assigneeChip().textContent).toMatch(/Bob$/);
    expect(assigneeChip().title).toMatch(/suggested by Jev/);

    fireEvent.click(screen.getByRole("button", { name: "Clear suggestions" }));
    expect(repeatChip().textContent).toBe("Repeat");
    expect(assigneeChip().textContent).toBe("Unassigned");
    expect(dueChip().textContent).toBe("Due Today");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Add item/ })));
    expect(vi.mocked(addItemAction)).toHaveBeenLastCalledWith(
      expect.objectContaining({ dueDate: "2026-11-14", repeat: null, assigneeIds: [] }),
    );
  });

  it("assigns you on a list only you can edit, unless you unassign yourself", async () => {
    const { rerender } = render(dialog(undefined, false, [me, { ...bob, canEdit: false }]));
    rerender(dialog(undefined, true, [me, { ...bob, canEdit: false }]));
    expect(screen.getByRole("button", { name: "Fred" })).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Add a task…"), { target: { value: "Water plants" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Add & create more/ })));
    expect(vi.mocked(addItemAction)).toHaveBeenLastCalledWith(
      expect.objectContaining({ assigneeIds: ["me"] }),
    );
  });

  it("ignores a label Claude found that the item's list doesn't have, but makes a #label", async () => {
    vi.mocked(aiRead).mockResolvedValue({
      projectId: "p1",
      duplicate: null,
      parent: null,
      due: null,
      repeat: null,
      label: null,
      assigneeId: null,
      titleParts: [
        { field: "label", label: "Finances", text: "Finances -", remove: true },
        { field: "label", label: "money", text: "#money", remove: true },
      ],
    });
    render(dialog());
    const title = screen.getByPlaceholderText<HTMLInputElement>("Add a task…");
    fireEvent.change(title, { target: { value: "Finances - pay rent #money" } });
    await act(() => new Promise((r) => setTimeout(r, 500)));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Add & create more/ })));
    expect(vi.mocked(addItemAction)).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "Finances - pay rent", labels: ["money"] }),
    );
  });

  it("adds without the title's parts that set its fields, unless one disagrees with a pick", async () => {
    const bins = "put the bins out tomorrow and every monday";
    vi.mocked(aiRead).mockResolvedValue({
      projectId: "p1",
      duplicate: null,
      parent: null,
      due: null,
      repeat: null,
      label: null,
      assigneeId: null,
      titleParts: [
        { field: "due", due: { dueFrom: null, dueDate: "2026-11-15" }, text: "tomorrow", remove: true },
        { field: "repeat", repeat: { every: 1, unit: "week", on: "mon" }, text: "every monday", remove: true },
      ],
    });
    render(dialog());
    const title = () => screen.getByPlaceholderText<HTMLInputElement>("Add a task…");
    fireEvent.change(title(), { target: { value: `TODO ${bins}` } });
    await act(() => new Promise((r) => setTimeout(r, 500)));
    // What's typed stays in the field; the line under it says what's added.
    expect(title().value).toBe(`TODO ${bins}`);
    expect(document.body.textContent).toContain("Adds as “Put the bins out”");
    // Once the caret leaves the title, it still says what the struck words set.
    fireEvent.blur(title());
    expect(document.body.textContent).toMatch(/“tomorrow” sets the due date: \w+.*“every monday” sets the repeat/);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Add & create more/ })));
    expect(vi.mocked(addItemAction)).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: "Put the bins out",
        dueDate: "2026-11-15",
        repeat: { every: 1, unit: "week", on: "mon" },
      }),
    );

    // Today picked first: \"tomorrow\" disagrees, so it stays and today stands.
    fireEvent.click(screen.getByRole("button", { name: "Due date" }));
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    fireEvent.change(title(), { target: { value: bins } });
    await act(() => new Promise((r) => setTimeout(r, 500)));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Add item/ })));
    expect(vi.mocked(addItemAction)).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "put the bins out tomorrow", dueDate: "2026-11-14" }),
    );
    vi.mocked(aiRead).mockReset();
    vi.mocked(aiRead).mockImplementation(() => new Promise(() => {}));
  });

  it("lets a date in the title replace the Brief's today, but not a date picked by hand", async () => {
    vi.mocked(aiRead).mockResolvedValue({
      projectId: "p1",
      duplicate: null,
      parent: null,
      due: null,
      repeat: null,
      label: null,
      assigneeId: null,
      titleParts: [
        { field: "due", due: { dueFrom: null, dueDate: "2026-11-17" }, text: "to tuesday", remove: true },
      ],
    });
    const { rerender } = render(dialog(true, false));
    rerender(dialog(true));
    const title = () => screen.getByPlaceholderText<HTMLInputElement>("Add a task…");
    const dueChip = () => screen.getByRole("button", { name: /^Due/ });
    fireEvent.change(title(), { target: { value: "add wash clothes to tuesday" } });
    await act(() => new Promise((r) => setTimeout(r, 500)));
    expect(dueChip().textContent).toBe("Due Tue");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Add & create more/ })));
    expect(vi.mocked(addItemAction)).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "Wash clothes", dueDate: "2026-11-17" }),
    );

    // Today picked on the chip: the title's Tuesday loses and stays.
    expect(dueChip().textContent).toBe("Due Today");
    fireEvent.click(dueChip());
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    fireEvent.change(title(), { target: { value: "add wash clothes to tuesday" } });
    await act(() => new Promise((r) => setTimeout(r, 500)));
    expect(dueChip().textContent).toBe("Due Today");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Add item/ })));
    expect(vi.mocked(addItemAction)).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "Wash clothes to tuesday", dueDate: "2026-11-14" }),
    );
    vi.mocked(aiRead).mockReset();
    vi.mocked(aiRead).mockImplementation(() => new Promise(() => {}));
  });

  it("opens an item it looks like it repeats, with a way back, until that's ignored", async () => {
    vi.mocked(aiRead).mockResolvedValue({
      projectId: "p1",
      duplicate: { id: "i22", ref: "HOM-22", title: "Clean Bathroom", topLevel: true },
      parent: null,
      due: null,
      repeat: null,
      label: null,
      assigneeId: null,
      titleParts: [],
    });
    const bathroom = { id: "i22", title: "Clean Bathroom" } as Item;
    render(
      <NewItemDialog
        open
        onOpenChange={() => {}}
        onOpenItem={() => {}}
        findItem={(id) => (id === bathroom.id ? bathroom : undefined)}
        renderItem={(item, view) => (
          <div>
            {view.back}
            <p>Details of {item.title}</p>
          </div>
        )}
        projects={[home]}
        assigneesByProject={{ p1: [] }}
        viewerId="me"
        initialProjectId="p1"
        shownOnBoard={() => true}
      />,
    );
    const title = () => screen.getByPlaceholderText<HTMLInputElement>("Add a task…");
    fireEvent.change(title(), { target: { value: "clean bathroom" } });
    await act(() => new Promise((r) => setTimeout(r, 500)));
    // The item slides in, in the same dialog, with a way back to the form.
    fireEvent.click(screen.getByRole("button", { name: /HOM-22 “Clean Bathroom”/ }));
    expect(screen.getByText("Details of Clean Bathroom")).toBeTruthy();
    expect(screen.queryByPlaceholderText("Add a task…")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back to New item" }));
    expect(title().value).toBe("clean bathroom");
    fireEvent.click(screen.getByRole("button", { name: "Ignore" }));
    expect(document.body.textContent).not.toContain("already on this list");
    // Ignored for this draft only: still ignored as it's edited.
    fireEvent.change(title(), { target: { value: "clean the bathroom" } });
    await act(() => new Promise((r) => setTimeout(r, 500)));
    expect(document.body.textContent).not.toContain("already on this list");
    vi.mocked(aiRead).mockReset();
    vi.mocked(aiRead).mockImplementation(() => new Promise(() => {}));
  });

  it("adds under the item it looks like it repeats, when it's a step of it instead", async () => {
    vi.mocked(aiRead).mockResolvedValue({
      projectId: "p1",
      duplicate: { id: "i8", ref: "HOM-8", title: "Sort through plants", topLevel: true },
      parent: null,
      due: null,
      repeat: null,
      label: null,
      assigneeId: null,
      titleParts: [],
    });
    render(dialog());
    fireEvent.change(screen.getByPlaceholderText("Add a task…"), {
      target: { value: "Sort out dying monstera" },
    });
    await act(() => new Promise((r) => setTimeout(r, 500)));
    fireEvent.click(screen.getByRole("button", { name: "Add as sub-item" }));
    expect(document.body.textContent).not.toContain("already on this list");
    expect(screen.getByRole("button", { name: "Don't add as a sub-item" })).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Add item/ })));
    expect(vi.mocked(addItemAction)).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "Sort out dying monstera", parentId: "i8" }),
    );
    vi.mocked(aiRead).mockReset();
    vi.mocked(aiRead).mockImplementation(() => new Promise(() => {}));
  });

  it("doesn't add a suggestion made for what was typed before", async () => {
    vi.mocked(aiRead).mockResolvedValueOnce({
      projectId: "p1",
      duplicate: null,
      parent: null,
      due: "friday",
      repeat: null,
      label: null,
      assigneeId: null,
      titleParts: [],
    });
    render(dialog());
    const title = () => screen.getByPlaceholderText<HTMLInputElement>("Add a task…");
    fireEvent.change(title(), { target: { value: "Pay rent friday" } });
    await act(() => new Promise((r) => setTimeout(r, 500)));
    expect(screen.getByRole("button", { name: /^Due/ }).textContent).toMatch(/Fri/);
    // Edited and added before Jev answers about the new text.
    fireEvent.change(title(), { target: { value: "Pay rent" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Add item/ })));
    expect(vi.mocked(addItemAction)).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "Pay rent", dueDate: null }),
    );
  });
});
