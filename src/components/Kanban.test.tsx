// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from "vitest";
import type { Item } from "@/core/schema";
import type { SpaceView } from "@/core/spaces";
import { NO_FILTERS } from "@/lib/filters";
import * as itemRef from "@/lib/itemRef";
import { Kanban, type ProjectView } from "./Kanban";
import * as shortcuts from "./useItemShortcuts";
import { GET_STARTED_STEPS, type GetStarted } from "@/lib/getStarted";

const GET_STARTED_DONE: GetStarted = {
  steps: [...GET_STARTED_STEPS],
  done: Object.fromEntries(GET_STARTED_STEPS.map((s) => [s, true])) as GetStarted["done"],
  queue: [],
  collapsed: true,
  pendingInvites: [],
};


// The server actions pull in server-only modules (next/cache, the DB).
vi.mock("@/app/actions", () => ({
  listDoneBeforeAction: vi.fn(),
  setTimeZoneAction: vi.fn(() => Promise.resolve()),
}));
// The Agenda's greeting; it never arrives here.
vi.mock("./ai-read", () => ({ aiRead: vi.fn(() => new Promise(() => {})) }));
// jsdom has no EventSource; the board's live updates have tests of their own.
vi.mock("./LiveUpdates", () => ({ LiveUpdates: () => null }));
// Each item row reads the selection once per render, and nothing else
// does, so counting the reads counts the rows' renders.
vi.mock("./useItemShortcuts", async (original) => {
  const actual = await original<typeof shortcuts>();
  return { ...actual, useRowSelection: vi.fn(actual.useRowSelection) };
});
// Rows and the palette's results work out item refs; counting the calls
// shows when the closed palette does that work.
vi.mock("@/lib/itemRef", async (original) => {
  const actual = await original<typeof itemRef>();
  return { ...actual, formatItemRef: vi.fn(actual.formatItemRef) };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  unstable_rethrow: vi.fn(),
}));

beforeAll(() => {
  // The arrow keys scroll the selected row into view; jsdom has no layout.
  Element.prototype.scrollIntoView = vi.fn();
  // The palette's list measures itself.
  window.ResizeObserver ??= class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  } as unknown as typeof ResizeObserver;
  window.IntersectionObserver = class {
    observe = vi.fn();
    disconnect = vi.fn();
  } as unknown as typeof IntersectionObserver;
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

const list = (
  id: string,
  name: string,
  status: ProjectView["status"],
  spaceId: string | null,
) =>
  ({
    id,
    name,
    status,
    prefix: name.slice(0, 3).toUpperCase(),
    refPrefix: name.slice(0, 3).toUpperCase(),
    summary: "",
    isOwner: true,
    spaceId,
  }) as unknown as ProjectView;

const board = (
  projects: ProjectView[],
  spaces: SpaceView[],
  itemsByProject: Record<string, Item[]> = { a: [], b: [] },
  followedItemIds: string[] = [],
) => (
  <Kanban
    viewerId="u1"
    viewer={null}
    timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}
    initialView="board"
    seq={0}
    overdueCollapsed={false}
    noDateCollapsed={false}
    noDateFoldedLists={[]}
    getStarted={GET_STARTED_DONE}
    projects={projects}
    itemsByProject={itemsByProject}
    completedSince={0}
    labelsByProject={{}}
    assigneesByProject={{}}
    prLinksByItem={{}}
    pendingInvites={[]}
    spaces={spaces}
    trayOrder={["personal", ...spaces.map((s) => s.id)]}
    pendingSpaceInvites={[]}
    pendingPhotos={[]}
    initialCollapsedTrays={[]}
    initialListId={null}
    initialItemId={null}
    notifications={[]}
    followedItemIds={followedItemIds}
    notificationLevels={{}}
    initialItemExtra={[]}
    filters={NO_FILTERS}
    aiEnabled={false}
  />
);

const space = { id: "s1", name: "Team", icon: null } as SpaceView;

describe.each([
  ["without Spaces", [] as SpaceView[], null],
  ["in a Space's tray", [space], space.id],
])("Kanban, an archived list %s", (_, spaces, spaceId) => {
  const columns = () =>
    [...document.querySelectorAll("[data-project-id]")].map((c) =>
      c.getAttribute("data-project-id"),
    );

  it("shows only in the Archived view", async () => {
    render(
      board(
        [list("a", "Home", "archived", spaceId), list("b", "Work", "active", spaceId)],
        spaces,
      ),
    );
    expect(columns()).toEqual(["b"]);

    const account = screen.getByRole("button", { name: "Account" });
    fireEvent.pointerDown(account);
    fireEvent.click(account);
    fireEvent.click(screen.getByRole("menuitem", { name: "Archived lists (1)" }));
    expect(await screen.findByRole("heading", { name: "Archived lists" })).toBeTruthy();
    expect(columns()).toEqual(["a"]);

    fireEvent.click(screen.getByRole("button", { name: "Back to board" }));
    await waitFor(() => expect(columns()).toEqual(["b"]));
  });
});

describe("Kanban, switching views", () => {
  it("puts each view at its own path, Brief on 1 and Board on 2, keeping the query", async () => {
    window.history.replaceState(null, "", "/board?x=1");
    render(board([list("b", "Work", "active", null)], []));
    const path = () => window.location.pathname + window.location.search;
    fireEvent.keyDown(document, { key: "1" });
    await waitFor(() => expect(path()).toBe("/brief?x=1"));
    fireEvent.keyDown(document, { key: "3" });
    await waitFor(() => expect(path()).toBe("/done?x=1"));
    fireEvent.keyDown(document, { key: "2" });
    await waitFor(() => expect(path()).toBe("/board?x=1"));
  });
});

describe("Kanban, the view switch", () => {
  it("shows the view asked for in the tabs at once, then only the last of quick presses", async () => {
    window.history.replaceState(null, "", "/board");
    render(board([list("b", "Work", "active", null)], []));
    const views = screen.getByRole("group", { name: "View" });
    const tab = (name: string) => within(views).getByRole("button", { name });
    fireEvent.keyDown(document, { key: "1" });
    expect(tab("Brief").getAttribute("aria-pressed")).toBe("true");
    expect(views.getAttribute("aria-busy")).toBe("true");
    fireEvent.keyDown(document, { key: "3" });
    expect(tab("Done").getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(window.location.pathname).toBe("/done"));
    expect(views.hasAttribute("aria-busy")).toBe(false);
    expect(document.querySelector("[data-project-id]")).toBeNull();
  });
});

describe("Kanban, re-rendering rows", () => {
  const item = (n: number, more: Partial<Item> = {}): Item => ({
    id: `i${n}`,
    projectId: "b",
    title: `Task ${n}`,
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
    position: `a${n}`,
    number: n,
    completedAt: null,
    createdAt: 0,
    ...more,
  });
  const work = [list("b", "Work", "active", null)];
  const rowRenders = vi.mocked(shortcuts.useRowSelection);

  it("leaves the rows alone when the board changes around them", () => {
    const items = [1, 2, 3].map((n) => item(n));
    const { rerender } = render(board(work, [], { b: items }, ["i1"]));
    expect(screen.getAllByText(/^Task \d$/)).toHaveLength(3);

    // Opening the Filter menu re-renders the board, not its rows, nor the
    // closed palette's item results.
    rowRenders.mockClear();
    vi.mocked(itemRef.formatItemRef).mockClear();
    fireEvent.keyDown(document, { key: "f" });
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.keyDown(document, { key: "f" });
    expect(rowRenders).not.toHaveBeenCalled();
    expect(itemRef.formatItemRef).not.toHaveBeenCalled();

    // Moving the selection re-renders only the rows it leaves and reaches.
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(document.querySelector("[data-selected]")?.textContent).toContain("Task 1");
    expect(rowRenders).toHaveBeenCalledTimes(1);
    rowRenders.mockClear();
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(document.querySelector("[data-selected]")?.textContent).toContain("Task 2");
    expect(rowRenders).toHaveBeenCalledTimes(2);

    // A refresh sends everything again as new objects: only the item that
    // changed re-renders.
    rowRenders.mockClear();
    const refreshed = items.map((i) => ({ ...i, labels: [...i.labels] }));
    refreshed[2] = { ...refreshed[2], title: "Task 9" };
    rerender(board(work, [], { b: refreshed }, ["i1"]));
    expect(screen.getByText("Task 9")).toBeTruthy();
    expect(rowRenders).toHaveBeenCalledTimes(1);
  });

  it("keeps a list's rows mounted as it grows long enough to render only some", () => {
    // jsdom has no layout: give the column and its rows a height, so the
    // long list has rows in view and rows out of it.
    const column = vi
      .spyOn(HTMLElement.prototype, "clientHeight", "get")
      .mockImplementation(function (this: HTMLElement) {
        return this.matches("[data-column-scroll]") ? 800 : 0;
      });
    const row52 = vi
      .spyOn(HTMLElement.prototype, "offsetHeight", "get")
      .mockImplementation(function (this: HTMLElement) {
        return this.matches("[data-list-index]") ? 52 : 0;
      });
    onTestFinished(() => {
      column.mockRestore();
      row52.mockRestore();
    });
    const items = Array.from({ length: 60 }, (_, i) => item(i + 1));
    const { rerender } = render(board(work, [], { b: items.slice(0, 59) }));
    expect(document.querySelectorAll("[data-item-row]")).toHaveLength(59);
    fireEvent.keyDown(document, { key: "ArrowDown" });
    const row = document.querySelector('[data-item-row="i1"]');
    expect(row?.hasAttribute("data-selected")).toBe(true);

    rerender(board(work, [], { b: items }));
    expect(document.querySelectorAll("[data-item-row]").length).toBeLessThan(60);
    expect(document.querySelector('[data-item-row="i1"]')).toBe(row);
  });

  it("moves the selection on an arrow from a row's assignee button, without opening its menu", () => {
    render(board(work, [], { b: [item(1), item(2)] }));
    const row = document.querySelector<HTMLElement>('[data-item-row="i2"]');
    if (!row) throw new Error("no row");
    // The pointer reaching the row mounts its menu; closing that leaves the
    // button focused, as Escape does.
    fireEvent.pointerEnter(row);
    const assign = within(row).getByRole("button", { name: "Assign" });
    assign.focus();
    fireEvent.keyDown(assign, { key: "ArrowDown" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.querySelector("[data-selected]")?.textContent).toContain("Task 1");
    expect(document.activeElement).not.toBe(assign);
  });

  it("finds an item in the palette once something is typed", () => {
    render(board(work, [], { b: [item(1), item(2)] }));
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    const search = screen.getByPlaceholderText("Search commands, lists, items…");
    expect(screen.queryByRole("option", { name: /Task 2/ })).toBeNull();
    fireEvent.change(search, { target: { value: "Task 2" } });
    expect(screen.getByRole("option", { name: /Task 2/ })).toBeTruthy();
  });
});
