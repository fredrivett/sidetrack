// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Item } from "@/core/schema";
import type { ProjectView } from "./Kanban";
import { TodayView } from "./TodayView";

// The server actions pull in server-only modules (next/cache, the DB).
vi.mock("@/app/actions", () => ({
  completeItemAction: vi.fn(),
  uncompleteItemAction: vi.fn(),
  deleteItemAction: vi.fn(),
  updateItemAction: vi.fn(),
  setItemParentAction: vi.fn(),
}));

beforeAll(() => {
  // Midday on Saturday the 14th, in whatever zone the tests run in.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 14, 12));
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
});
afterAll(() => vi.useRealTimers());
afterEach(cleanup);

const project = { id: "p1", name: "Home", refPrefix: "HOME" } as unknown as ProjectView;
let n = 0;
const item = (title: string, dueDate: string | null, more: Partial<Item> = {}): Item => ({
  id: `i${++n}`,
  projectId: "p1",
  title,
  description: null,
  category: null,
  assigneeId: null,
  parentId: null,
  dueDate,
  position: `a${n}`,
  number: n,
  completedAt: null,
  createdAt: 0,
  ...more,
});

function renderToday(items: Item[]) {
  render(
    <TodayView
      projects={[project]}
      itemsByProject={{ p1: items }}
      assigneesByProject={{}}
      prLinksByItem={{}}
      viewerId="me"
    />,
  );
}

const section = (name: RegExp) =>
  screen.getByRole("heading", { name }).closest("section") as HTMLElement;

describe("TodayView", () => {
  it("splits overdue from today and counts open items per filter", () => {
    renderToday([
      item("today, mine", "2026-11-14", { assigneeId: "me" }),
      item("late, theirs", "2026-11-10", { assigneeId: "them" }),
      item("today, done", "2026-11-14", { completedAt: new Date(2026, 10, 14, 9).getTime() }),
      item("tomorrow", "2026-11-15"),
      item("no date", null),
    ]);

    expect(within(section(/Overdue/)).getByText("late, theirs")).toBeTruthy();
    expect(within(section(/Overdue/)).queryByText("today, mine")).toBeNull();
    const today = within(section(/^Today/));
    expect(today.getByText("today, mine")).toBeTruthy();
    expect(today.getByText("today, done")).toBeTruthy();
    expect(screen.queryByText("tomorrow")).toBeNull();
    expect(screen.queryByText("no date")).toBeNull();

    // Counts are open items only: the finished one shows but doesn't count.
    const filters = within(screen.getByRole("group", { name: "Whose items" }));
    expect(filters.getByRole("button", { name: /All/ }).textContent).toBe("All2");
    expect(filters.getByRole("button", { name: /Mine/ }).textContent).toBe("Mine1");
    expect(filters.getByRole("button", { name: /Theirs/ }).textContent).toBe("Theirs1");
    expect(filters.getByRole("button", { name: /Unassigned/ }).textContent).toBe("Unassigned");

    fireEvent.click(filters.getByRole("button", { name: /Theirs/ }));
    expect(screen.getByText("late, theirs")).toBeTruthy();
    expect(screen.queryByText("today, mine")).toBeNull();
  });

  it("says when nothing is due, and when a filter hides everything", () => {
    renderToday([item("later", "2026-11-20")]);
    expect(screen.getByText(/Nothing due today/)).toBeTruthy();
    cleanup();

    renderToday([item("mine", "2026-11-14", { assigneeId: "me" })]);
    fireEvent.click(screen.getByRole("button", { name: /Theirs/ }));
    expect(screen.getByText("Nothing here for this filter.")).toBeTruthy();
  });
});
