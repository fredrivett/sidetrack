// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Item } from "@/core/schema";
import { NO_FILTERS } from "@/lib/filters";
import { DoneView } from "./DoneView";
import type { ProjectView } from "./Kanban";

// The server actions pull in server-only modules (next/cache, the DB).
vi.mock("@/app/actions", () => ({
  completeItemAction: vi.fn(),
  uncompleteItemAction: vi.fn(),
  deleteItemAction: vi.fn(),
  updateItemAction: vi.fn(),
  setItemParentAction: vi.fn(),
}));

beforeAll(() => {
  // Midday on Sunday the 15th, in whatever zone the tests run in.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 15, 12));
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
const item = (title: string, more: Partial<Item> = {}): Item => ({
  id: `i${++n}`,
  projectId: "p1",
  title,
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
  position: `a${n}`,
  number: n,
  completedAt: null,
  createdAt: 0,
  ...more,
});
const at = (day: number, h: number) => new Date(2026, 10, day, h).getTime();

describe("DoneView", () => {
  it("lists finished items newest first by day, down to `since`", () => {
    const trip = item("Trip");
    render(
      <DoneView
        projects={[project]}
        itemsByProject={{
          p1: [
            item("Open"),
            trip,
            // Finished at 1am Sunday: still Saturday's, by the 4am turnover.
            item("Book trains", { parentId: trip.id, completedAt: at(15, 1) }),
            item("Water plants", { completedAt: at(15, 9) }),
            item("Bins", { completedAt: at(12, 8) }),
            // Older than `since`: loaded for a checklist, not shown yet.
            item("Tax return", { completedAt: at(2, 8) }),
          ],
        }}
        assigneesByProject={{}}
        prLinksByItem={{}}
        viewerId="me"
        filters={NO_FILTERS}
        since={at(10, 0)}
        more={false}
        loading={false}
        failed={false}
        onLoadMore={() => {}}
        onRetry={() => {}}
      />,
    );

    // Each heading ends with its count; the date's format follows the locale.
    const headings = screen.getAllByRole("heading").map((h) => h.textContent);
    expect(headings.slice(0, 2)).toEqual(["Today1", "Yesterday1"]);
    expect(headings.slice(2)).toEqual([
      `${new Date(2026, 10, 12).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      })}1`,
    ]);
    const yesterday = screen
      .getByRole("heading", { name: /Yesterday/ })
      .closest("section") as HTMLElement;
    expect(within(yesterday).getByText("Book trains")).toBeTruthy();
    // A sub-item names its list and parent.
    expect(within(yesterday).getByText("Home › Trip")).toBeTruthy();
    expect(screen.queryByText("Tax return")).toBeNull();
    expect(screen.queryByText("Open")).toBeNull();
    expect(screen.getByText("That's everything.")).toBeTruthy();
  });

  it("offers Try again after a failed read, instead of loading for ever", () => {
    const onRetry = vi.fn();
    render(
      <DoneView
        projects={[project]}
        itemsByProject={{ p1: [] }}
        assigneesByProject={{}}
        prLinksByItem={{}}
        viewerId="me"
        filters={NO_FILTERS}
        since={0}
        more
        loading={false}
        failed
        onLoadMore={() => {}}
        onRetry={onRetry}
      />,
    );
    expect(screen.queryByText("Loading…")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
