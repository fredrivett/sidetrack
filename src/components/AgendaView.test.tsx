// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { setItemsCollapsedAction, setOverdueCollapsedAction } from "@/app/actions";
import type { Item } from "@/core/schema";
import { AgendaView } from "./AgendaView";
import type { ProjectView } from "./Kanban";

// The server actions pull in server-only modules (next/cache, the DB).
vi.mock("@/app/actions", () => ({
  completeItemAction: vi.fn(),
  uncompleteItemAction: vi.fn(),
  deleteItemAction: vi.fn(),
  updateItemAction: vi.fn(),
  setItemParentAction: vi.fn(),
  reorderItemAction: vi.fn(),
  setItemsCollapsedAction: vi.fn(),
  setOverdueCollapsedAction: vi.fn(),
  // The item dialog reads its comments when it opens, and its history when expanded.
  listCommentsAction: vi.fn(async () => []),
  listAuditAction: vi.fn(async () => []),
}));

beforeAll(() => {
  // Midday on Saturday the 14th, in whatever zone the tests run in. This
  // week is the 9th to the 15th, next week the 16th to the 22nd.
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

const list = (id: string, name: string) =>
  ({ id, name, refPrefix: id.toUpperCase(), icon: null, homepageUrl: null }) as unknown as ProjectView;
const home = list("p1", "Home");
let n = 0;
const item = (title: string, dueDate: string | null, more: Partial<Item> = {}): Item => ({
  id: `i${++n}`,
  projectId: "p1",
  title,
  description: null,
  labels: [],
  assigneeIds: [],
  parentId: null,
  collapsed: false,
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
const doneOn = (day: number) => ({ completedAt: new Date(2026, 10, day, 9).getTime() });

function renderAgenda(items: Item[], projects = [home], overdueCollapsed = false) {
  const itemsByProject: Record<string, Item[]> = {};
  for (const i of items) (itemsByProject[i.projectId] ??= []).push(i);
  render(
    <AgendaView
      projects={projects}
      itemsByProject={itemsByProject}
      assigneesByProject={{}}
      prLinksByItem={{}}
      viewerId="me"
      overdueCollapsed={overdueCollapsed}
    />,
  );
}

const section = (name: RegExp) =>
  screen.getByRole("heading", { level: 2, name }).closest("section") as HTMLElement;

describe("AgendaView", () => {
  it("runs from overdue to no date, placing each item by its due day or span", () => {
    renderAgenda([
      item("Dentist", "2026-11-23"),
      item("Call the bank", "2026-11-08", { dueFrom: "2026-11-02" }),
      item("Bins", "2026-11-14"),
      item("Sunday walk", "2026-11-15"),
      item("Book boiler service", "2026-11-15", { dueFrom: "2026-11-09" }),
      item("Clean car", "2026-11-15", { dueFrom: "2026-11-14" }),
      item("Monday standup", "2026-11-16"),
      item("Plan trip", "2026-11-22", { dueFrom: "2026-11-16" }),
      item("Sort garage", null),
      // Finished early today: crossed out where it was, not gone.
      item("Pay rent", "2026-11-20", doneOn(14)),
      // Finished before today: off the agenda, dated or not.
      item("Old chore", "2026-11-14", doneOn(13)),
      item("Old idea", null, doneOn(13)),
    ]);

    expect(
      screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent?.replace(/\d+$/, "")),
    ).toEqual(["Overdue", "Today", "This week", "Next week", "Later", "No date"]);
    const rows: Array<[RegExp, string[]]> = [
      [/^Overdue/, ["Call the bank"]],
      [/^Today/, ["Bins"]],
      // Sunday ends this week; a span under way stays here to its last day.
      [/^This week/, ["Sunday walk", "Book boiler service", "Clean car"]],
      [/^Next week/, ["Monday standup", "Pay rent", "Plan trip"]],
      [/^Later/, ["Dentist"]],
      [/^No date/, ["Sort garage"]],
    ];
    for (const [name, titles] of rows) {
      const s = within(section(name));
      for (const t of titles) expect(s.getByText(t)).toBeTruthy();
      expect(s.getAllByRole("checkbox")).toHaveLength(titles.length);
    }
    // Next week's count is what's left: Pay rent is done.
    expect(screen.getByRole("heading", { level: 2, name: /^Next week/ }).textContent).toBe(
      "Next week2",
    );
    expect(screen.queryByText("Old chore")).toBeNull();
    expect(screen.queryByText("Old idea")).toBeNull();
  });

  it("counts open items per filter and narrows every section", () => {
    renderAgenda([
      item("today, mine", "2026-11-14", { assigneeIds: ["me"] }),
      item("late, theirs", "2026-11-10", { assigneeIds: ["them"] }),
      // A joint item that includes the viewer counts as Mine, not Theirs.
      item("next week, ours", "2026-11-18", { assigneeIds: ["them", "me"] }),
      item("today, done", "2026-11-14", doneOn(14)),
      item("no date", null),
    ]);

    const filters = within(screen.getByRole("group", { name: "Whose items" }));
    expect(filters.getByRole("button", { name: /All/ }).textContent).toBe("All4");
    expect(filters.getByRole("button", { name: /Mine/ }).textContent).toBe("Mine2");
    expect(filters.getByRole("button", { name: /Theirs/ }).textContent).toBe("Theirs1");
    expect(filters.getByRole("button", { name: /Unassigned/ }).textContent).toBe("Unassigned1");

    fireEvent.click(filters.getByRole("button", { name: /Mine/ }));
    expect(screen.getByText("today, mine")).toBeTruthy();
    expect(screen.getByText("next week, ours")).toBeTruthy();
    expect(screen.queryByText("late, theirs")).toBeNull();
    expect(screen.queryByRole("heading", { level: 2, name: /No date/ })).toBeNull();
  });

  it("groups undated items by list and keeps a filtered sub-item with its parent named", () => {
    const buy = list("p2", "Buy");
    const tidy = item("Tidy flat", null);
    const kitchen = item("Kitchen", null, { parentId: tidy.id, assigneeIds: ["me"] });
    const plan = item("Phone plan", "2026-11-18");
    renderAgenda(
      [
        tidy,
        kitchen,
        plan,
        item("Fred's SIM", null, { parentId: plan.id }),
        item("Slippers", null, { projectId: "p2" }),
      ],
      [home, buy],
    );

    const noDate = within(section(/^No date/));
    expect(noDate.getByRole("heading", { level: 3, name: /Home/ })).toBeTruthy();
    expect(noDate.getByRole("heading", { level: 3, name: /Buy/ })).toBeTruthy();
    expect(noDate.getByText("Tidy flat")).toBeTruthy();
    expect(noDate.getByText("Kitchen")).toBeTruthy();
    // A dated parent's checklist is planned with it, under its date.
    expect(within(section(/^Next week/)).getByText("Phone plan")).toBeTruthy();
    expect(screen.queryByText("Fred's SIM")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Mine/ }));
    expect(screen.queryByRole("heading", { level: 3, name: /Buy/ })).toBeNull();
    // Its parent is filtered out, so only the sub-item's row shows, naming it.
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.getByText("Kitchen").closest("button")?.textContent).toContain("Tidy flat");
  });

  it("folds an undated checklist away as stored on the item, and saves a toggle", () => {
    const tidy = item("Tidy flat", null, { collapsed: true });
    const trip = item("Plan trip", null);
    renderAgenda([
      tidy,
      item("Kitchen", null, { parentId: tidy.id }),
      trip,
      item("Book flights", null, { parentId: trip.id }),
    ]);

    expect(screen.queryByText("Kitchen")).toBeNull();
    expect(screen.getByText("Book flights")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Show checklist/ }));
    expect(vi.mocked(setItemsCollapsedAction)).toHaveBeenCalledWith([tidy.id], false);
  });

  it("shows a shared list's qualified ref in the item dialog, as on its row", () => {
    // A shared list whose prefix clashes with one of the viewer's own.
    const shared = { ...home, prefix: "HOME", refPrefix: "alice/HOME" } as ProjectView;
    const bins = item("Bins", "2026-11-14");
    renderAgenda([bins], [shared]);
    fireEvent.click(screen.getByText("Bins"));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(`alice/HOME-${bins.number}`)).toBeTruthy();
  });

  it("folds Overdue away as saved for the viewer, and saves a toggle", () => {
    renderAgenda([item("Call the bank", "2026-11-10"), item("Bins", "2026-11-14")], [home], true);

    const toggle = screen.getByRole("button", { name: /^Overdue/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    // Folded rows stay out of reach (inert) but the count still shows.
    const rows = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
    expect(rows?.hasAttribute("inert")).toBe(true);
    expect(rows?.textContent).toContain("Call the bank");
    expect(toggle.textContent).toContain("1");
    expect(rows?.closest("[inert]")?.contains(screen.getByText("Bins"))).toBe(false);

    // Still saving, so the open state shown is the optimistic one.
    vi.mocked(setOverdueCollapsedAction).mockReturnValue(new Promise(() => {}));
    fireEvent.click(toggle);
    expect(vi.mocked(setOverdueCollapsedAction)).toHaveBeenLastCalledWith(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(rows?.hasAttribute("inert")).toBe(false);
  });

  it("says when there's nothing to do, and when a filter hides everything", () => {
    renderAgenda([item("done", "2026-11-14", doneOn(13))]);
    expect(screen.getByText("Nothing to do.")).toBeTruthy();
    cleanup();

    renderAgenda([item("mine", "2026-11-20", { assigneeIds: ["me"] })]);
    fireEvent.click(screen.getByRole("button", { name: /Theirs/ }));
    expect(screen.getByText("Nothing here for this filter.")).toBeTruthy();
  });
});
