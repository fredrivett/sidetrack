// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  setAgendaReadAction,
  setItemsCollapsedAction,
  setOverdueCollapsedAction,
} from "@/app/actions";
import type { Greeting } from "@/core/agendaGreeting";
import type { Item } from "@/core/schema";
import { type ItemFilters, NO_FILTERS } from "@/lib/filters";
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
  setAgendaReadAction: vi.fn(),
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
  Element.prototype.scrollIntoView = vi.fn();
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

function renderAgenda(
  items: Item[],
  projects = [home],
  overdueCollapsed = false,
  filters: Partial<ItemFilters> = {},
  greeting: Greeting | null = null,
) {
  const itemsByProject: Record<string, Item[]> = {};
  for (const i of items) (itemsByProject[i.projectId] ??= []).push(i);
  return render(
    <AgendaView
      projects={projects}
      itemsByProject={itemsByProject}
      assigneesByProject={{}}
      prLinksByItem={{}}
      viewerId="me"
      overdueCollapsed={overdueCollapsed}
      greeting={greeting}
      filters={{ ...NO_FILTERS, ...filters }}
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

  it("narrows every section to the header's filters", () => {
    const mixed = () => [
      item("today, mine", "2026-11-14", { assigneeIds: ["me"] }),
      item("late, theirs", "2026-11-10", { assigneeIds: ["them"] }),
      item("next week, ours", "2026-11-18", { assigneeIds: ["them", "me"] }),
      item("today, done", "2026-11-14", doneOn(14)),
      item("no date", null, { labels: ["errand"] }),
    ];
    renderAgenda(mixed(), [home], false, { assignees: ["me"] });
    expect(screen.getByText("today, mine")).toBeTruthy();
    // A joint item shows for either of its people.
    expect(screen.getByText("next week, ours")).toBeTruthy();
    expect(screen.queryByText("late, theirs")).toBeNull();
    expect(screen.queryByRole("heading", { level: 2, name: /No date/ })).toBeNull();
    cleanup();

    renderAgenda(mixed(), [home], false, { labels: ["errand"] });
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.getByText("no date")).toBeTruthy();
    cleanup();

    // Done today off, and only what's late.
    renderAgenda(mixed(), [home], false, { doneToday: false, due: ["overdue", "today"] });
    expect(screen.getByText("today, mine")).toBeTruthy();
    expect(screen.getByText("late, theirs")).toBeTruthy();
    expect(screen.queryByText("today, done")).toBeNull();
    expect(screen.queryByText("next week, ours")).toBeNull();
  });

  it("groups undated items by list and keeps a filtered sub-item with its parent named", () => {
    const buy = list("p2", "Buy");
    const tidy = item("Tidy flat", null);
    const kitchen = item("Kitchen", null, { parentId: tidy.id, assigneeIds: ["me"] });
    const plan = item("Phone plan", "2026-11-18");
    const items = [
      tidy,
      kitchen,
      plan,
      item("Fred's SIM", null, { parentId: plan.id }),
      item("Slippers", null, { projectId: "p2" }),
    ];
    renderAgenda(items, [home, buy]);

    const noDate = within(section(/^No date/));
    expect(noDate.getByRole("heading", { level: 3, name: /Home/ })).toBeTruthy();
    expect(noDate.getByRole("heading", { level: 3, name: /Buy/ })).toBeTruthy();
    expect(noDate.getByText("Tidy flat")).toBeTruthy();
    expect(noDate.getByText("Kitchen")).toBeTruthy();
    // A dated parent's checklist is planned with it, under its date.
    expect(within(section(/^Next week/)).getByText("Phone plan")).toBeTruthy();
    expect(screen.queryByText("Fred's SIM")).toBeNull();

    cleanup();
    renderAgenda(items, [home, buy], false, { assignees: ["me"] });
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

  it("greets with chips that open their items, and a triage phrase that opens Overdue", () => {
    const late = item("Call the bank", "2026-11-10");
    const bins = item("Bins", "2026-11-14");
    vi.mocked(setOverdueCollapsedAction).mockReturnValue(new Promise(() => {}));
    renderAgenda([late, bins], [home], true, {}, {
      hello: "Good afternoon.",
      text: `Since Friday you've finished {{item:gone}}. {{item:${late.id}}} is still waiting. No rush — want to {{action:triage|give it a new day}}?`,
      titles: { gone: "Renew passport", [late.id]: "Call the bank" },
      others: [],
    });
    const greeting = screen.getByText(/^Good afternoon/);
    expect(greeting.textContent).toBe(
      "Good afternoon. Since Friday you've finished Renew passport. Call the bank is still waiting. No rush — want to give it a new day?",
    );
    // An item the page hasn't loaded is named, but isn't a button.
    expect(within(greeting).queryByRole("button", { name: "Renew passport" })).toBeNull();

    fireEvent.click(within(greeting).getByRole("button", { name: "give it a new day" }));
    expect(vi.mocked(setOverdueCollapsedAction)).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole("button", { name: /^Overdue/ }).getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(within(greeting).getByRole("button", { name: "Call the bank" }));
    expect(within(screen.getByRole("dialog")).getByText(`P1-${late.number}`)).toBeTruthy();
  });

  it("counts the greeting read when the viewer leaves it, not at a glance", () => {
    const greeting = { hello: "Good morning.", text: "", titles: {}, others: [] };
    vi.mocked(setAgendaReadAction).mockClear();
    renderAgenda([], [home], false, {}, greeting);
    cleanup();
    expect(vi.mocked(setAgendaReadAction)).not.toHaveBeenCalled();

    renderAgenda([], [home], false, {}, greeting);
    vi.setSystemTime(Date.now() + 5000);
    cleanup();
    expect(vi.mocked(setAgendaReadAction)).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date(2026, 10, 14, 12));
  });

  it("stamps a read when the tab is hidden, but keeps showing the greeting it opened with", () => {
    vi.mocked(setAgendaReadAction).mockClear();
    const props = (text: string) => (
      <AgendaView
        projects={[home]}
        itemsByProject={{}}
        assigneesByProject={{}}
        prLinksByItem={{}}
        viewerId="me"
        overdueCollapsed={false}
        greeting={{ hello: "Good morning.", text, titles: {}, others: [] }}
        filters={NO_FILTERS}
      />
    );
    const { rerender } = render(props("Since Friday you've finished four."));
    vi.setSystemTime(Date.now() + 5000);
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    expect(vi.mocked(setAgendaReadAction)).toHaveBeenCalledTimes(1);
    // The board reloads with a greeting written after the stamp.
    rerender(props(""));
    expect(screen.getByText(/^Good morning/).textContent).toBe(
      "Good morning. Since Friday you've finished four.",
    );
    vi.setSystemTime(new Date(2026, 10, 14, 12));
  });

  it("says when there's nothing to do, and when the filters hide everything", () => {
    renderAgenda([item("done", "2026-11-14", doneOn(13))]);
    expect(screen.getByText("Nothing to do.")).toBeTruthy();
    cleanup();

    renderAgenda([item("mine", "2026-11-20", { assigneeIds: ["me"] })], [home], false, {
      unassigned: true,
    });
    expect(screen.getByText("Nothing here for your filters.")).toBeTruthy();
  });
});
