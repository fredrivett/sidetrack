// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { addItemAction } from "@/app/actions";
import type { Item } from "@/core/schema";
import type { ProjectView } from "./Kanban";
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
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  Element.prototype.scrollIntoView = vi.fn();
});
afterAll(() => vi.useRealTimers());
afterEach(() => {
  cleanup();
  localStorage.clear();
});

const home = { id: "p1", name: "Home", refPrefix: "HOM", icon: null, status: "active" } as unknown as ProjectView;

const dialog = (dueToday?: boolean, open = true) => (
  <NewItemDialog
    open={open}
    onOpenChange={() => {}}
    onOpenItem={() => {}}
    projects={[home]}
    assigneesByProject={{}}
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
});
