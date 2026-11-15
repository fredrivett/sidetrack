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
  assigneeIds: [],
  parentId: null,
  dueDate,
  dueFrom: null,
  repeatEvery: null,
  repeatUnit: null,
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
      item("today, mine", "2026-11-14", { assigneeIds: ["me"] }),
      item("late, theirs", "2026-11-10", { assigneeIds: ["them"] }),
      // A joint item that includes the viewer counts as Mine, not Theirs.
      item("today, ours", "2026-11-14", { assigneeIds: ["them", "me"] }),
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
    expect(filters.getByRole("button", { name: /All/ }).textContent).toBe("All3");
    expect(filters.getByRole("button", { name: /Mine/ }).textContent).toBe("Mine2");
    expect(filters.getByRole("button", { name: /Theirs/ }).textContent).toBe("Theirs1");
    expect(filters.getByRole("button", { name: /Unassigned/ }).textContent).toBe("Unassigned");

    fireEvent.click(filters.getByRole("button", { name: /Theirs/ }));
    expect(screen.getByText("late, theirs")).toBeTruthy();
    expect(screen.queryByText("today, mine")).toBeNull();
    expect(screen.queryByText("today, ours")).toBeNull();

    fireEvent.click(filters.getByRole("button", { name: /Mine/ }));
    expect(screen.getByText("today, ours")).toBeTruthy();
    expect(screen.queryByText("late, theirs")).toBeNull();
  });

  it("lists spans under way under This weekend or This week, to their last day", () => {
    // Saturday 14 November: this week is the 9th to the 15th.
    renderToday([
      item("Bins", "2026-11-14"),
      item("Book boiler service", "2026-11-15", { dueFrom: "2026-11-09" }),
      item("Clean car", "2026-11-15", { dueFrom: "2026-11-14" }),
      item("Send invoices", "2026-11-14", { dueFrom: "2026-11-09" }),
      item("Call the bank", "2026-11-08", { dueFrom: "2026-11-02" }),
      item("Plan trip", "2026-11-22", { dueFrom: "2026-11-16" }),
    ]);
    expect(
      screen.getAllByRole("heading").map((h) => h.textContent?.replace(/\d+$/, "")),
    ).toEqual(["Overdue", "Today", "This weekend", "This week"]);
    const rows: Array<[RegExp, string[]]> = [
      [/^Overdue/, ["Call the bank"]],
      [/^Today/, ["Bins"]],
      [/^This weekend/, ["Clean car"]],
      // Ending today, a span stays in its section; its chip turns amber.
      [/^This week\d/, ["Book boiler service", "Send invoices"]],
    ];
    for (const [name, titles] of rows) {
      const s = within(section(name));
      for (const t of titles) expect(s.getByText(t)).toBeTruthy();
      expect(s.getAllByText(/./, { selector: "span.text-sm" })).toHaveLength(titles.length);
    }
    // The heading, and the item's chip.
    expect(within(section(/^This weekend/)).getAllByText("This weekend")).toHaveLength(2);
    expect(screen.queryByText("Plan trip")).toBeNull();
  });

  it("shows a shared list's qualified ref in the item dialog, as on its row", () => {
    // A shared list whose prefix clashes with one of the viewer's own.
    const shared = { ...project, prefix: "HOME", refPrefix: "alice/HOME" } as ProjectView;
    const bins = item("Bins", "2026-11-14");
    render(
      <TodayView
        projects={[shared]}
        itemsByProject={{ p1: [bins] }}
        assigneesByProject={{}}
        prLinksByItem={{}}
        viewerId="me"
      />,
    );
    fireEvent.click(screen.getByText("Bins"));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(`alice/HOME-${bins.number}`)).toBeTruthy();
  });

  it("says when nothing is due, and when a filter hides everything", () => {
    renderToday([item("later", "2026-11-20")]);
    expect(screen.getByText(/Nothing due today/)).toBeTruthy();
    cleanup();

    renderToday([item("mine", "2026-11-14", { assigneeIds: ["me"] })]);
    fireEvent.click(screen.getByRole("button", { name: /Theirs/ }));
    expect(screen.getByText("Nothing here for this filter.")).toBeTruthy();
  });
});
