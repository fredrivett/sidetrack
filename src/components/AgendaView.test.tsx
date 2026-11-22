// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  setAgendaReadAction,
  setItemsCollapsedAction,
  setOverdueCollapsedAction,
  setNoDateCollapsedAction,
  setNoDateListFoldedAction,
} from "@/app/actions";
import { aiRead } from "./ai-read";
import type { Greeting } from "@/core/agendaGreeting";
import type { FeedbackAbout } from "./FeedbackDialog";
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
  setNoDateCollapsedAction: vi.fn(),
  setNoDateListFoldedAction: vi.fn(),
  setAgendaReadAction: vi.fn(),
  // The item dialog reads its comments when it opens, and its history when expanded.
  listCommentsAction: vi.fn(async () => ({ comments: [], mentionable: [] })),
  getItemSourceAction: vi.fn(async () => null),
  listAuditAction: vi.fn(async () => []),
}));
// The greeting is the only AI read here.
vi.mock("./ai-read", () => ({ aiRead: vi.fn(async () => null) }));

beforeAll(() => {
  // Midday on Saturday the 14th, in whatever zone the tests run in. This
  // week is the 9th to the 15th, next week the 16th to the 22nd.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 14, 12));
  // Reduced motion, so the greeting dialog swaps views without animating,
  // which jsdom can't.
  window.matchMedia = ((query: string) => ({
    matches: query.includes("reduce"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  Element.prototype.scrollIntoView = vi.fn();
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
  createdBy: null,
  parentId: null,
  collapsed: false,
  dueDate,
  dueFrom: null,
  repeatEvery: null,
  repeatUnit: null,
  repeatOn: null,
  repeatDay: null,
  smartRule: null,
  smartLead: null,
  cancelled: false,
  cancelReason: null,
  replacedById: null,
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
  greet = false,
  onFeedback?: (about: FeedbackAbout) => void,
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
      noDateCollapsed={false}
      noDateFoldedLists={[]}
      greet={greet}
      firstName="Fred"
      onFeedback={onFeedback}
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
    ).toEqual(["Overdue", "Today", "Tomorrow", "This weekend", "Next week", "Later", "No date"]);
    const rows: Array<[RegExp, string[]]> = [
      [/^Overdue/, ["Call the bank"]],
      [/^Today/, ["Bins"]],
      // Due tomorrow alone; a span ending tomorrow isn't.
      [/^Tomorrow/, ["Sunday walk"]],
      // Sunday ends this week; a span under way stays here to its last day.
      // It's Saturday, so what's left of the week is the weekend.
      [/^This weekend/, ["Book boiler service", "Clean car"]],
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

  it("calls the rest of the week This week on a weekday", () => {
    vi.setSystemTime(new Date(2026, 10, 13, 12));
    try {
      renderAgenda([item("Clean car", "2026-11-15", { dueFrom: "2026-11-14" })]);
      expect(screen.getByRole("heading", { level: 2, name: /^This week/ }).textContent).toBe(
        "This week1",
      );
    } finally {
      vi.setSystemTime(new Date(2026, 10, 14, 12));
    }
  });

  it("shows only what's the viewer's or nobody's", () => {
    const theirs = item("Their launch", null, { assigneeIds: ["them"] });
    renderAgenda([
      item("Mine", "2026-11-14", { assigneeIds: ["me"] }),
      item("Nobody's", "2026-11-14"),
      item("Joint", "2026-11-14", { assigneeIds: ["them", "me"] }),
      item("Theirs", "2026-11-14", { assigneeIds: ["them"] }),
      theirs,
      // An unassigned step under their task stays theirs; one assigned to me doesn't.
      item("Their step", null, { parentId: theirs.id }),
      item("My step", null, { parentId: theirs.id, assigneeIds: ["me"] }),
    ]);
    for (const shown of ["Mine", "Nobody's", "Joint", "My step"]) expect(screen.getByText(shown)).toBeTruthy();
    for (const hidden of ["Theirs", "Their step"]) expect(screen.queryByText(hidden)).toBeNull();
    cleanup();

    // Only theirs: nothing to do, not a filter hiding things.
    renderAgenda([item("Theirs", "2026-11-14", { assigneeIds: ["them"] })]);
    expect(screen.getByText("Nothing to do.")).toBeTruthy();
    expect(screen.getByText("Nothing to do.")).toBeTruthy();
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
    // A dated parent's checklist is planned with it, under it in its section.
    const nextWeek = within(section(/^Next week/));
    expect(nextWeek.getByText("Phone plan")).toBeTruthy();
    expect(nextWeek.getByLabelText(/checklist, 0 of 1 done/)).toBeTruthy();
    expect(nextWeek.getByText("Fred's SIM")).toBeTruthy();
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

  it("goes back from a sub-item to the item it was opened from, without piling up", async () => {
    const tidy = item("Tidy flat", "2026-11-14");
    const kitchen = item("Kitchen", null, { parentId: tidy.id });
    renderAgenda([tidy, kitchen]);
    fireEvent.click(screen.getByText("Tidy flat"));
    const dialog = () => within(screen.getByRole("dialog"));
    // Opened from the page: nothing to go back to.
    expect(dialog().queryByRole("button", { name: /^Back to/ })).toBeNull();

    fireEvent.click(dialog().getByRole("button", { name: "Kitchen" }));
    expect(dialog().getByText(`P1-${kitchen.number}`)).toBeTruthy();
    fireEvent.click(dialog().getByRole("button", { name: "Back to Tidy flat" }));
    expect(dialog().getByText(`P1-${tidy.number}`)).toBeTruthy();
    expect(dialog().queryByRole("button", { name: /^Back to/ })).toBeNull();
    // Back where it was opened from.
    expect(document.activeElement).toBe(dialog().getByRole("button", { name: "Kitchen" }));

    // Going to the parent it came from is going back, not a step further.
    fireEvent.click(dialog().getByRole("button", { name: "Kitchen" }));
    fireEvent.click(dialog().getByTitle("Sub-item of"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Open parent" }));
    expect(dialog().getByText(`P1-${tidy.number}`)).toBeTruthy();
    expect(dialog().queryByRole("button", { name: /^Back to/ })).toBeNull();
  });

  it("folds Overdue away as saved for the viewer, and saves a toggle", () => {
    renderAgenda([item("Call the bank", "2026-11-10"), item("Bins", "2026-11-14")], [home], true);

    const toggle = screen.getByRole("button", { name: /^Overdue/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    // Folded, its rows aren't rendered (Fold), but the count still shows.
    const rows = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
    expect(rows?.hasAttribute("inert")).toBe(true);
    expect(screen.queryByText("Call the bank")).toBeNull();
    expect(toggle.textContent).toContain("1");
    expect(rows?.contains(screen.getByText("Bins"))).toBe(false);

    // Still saving, so the open state shown is the optimistic one.
    vi.mocked(setOverdueCollapsedAction).mockReturnValue(new Promise(() => {}));
    fireEvent.click(toggle);
    expect(vi.mocked(setOverdueCollapsedAction)).toHaveBeenLastCalledWith(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(rows?.hasAttribute("inert")).toBe(false);
    expect(rows?.textContent).toContain("Call the bank");
  });

  it("folds No date away at once and saves it, keeping each list's card", () => {
    renderAgenda([item("Tidy flat", null), item("Bins", "2026-11-14")]);
    const toggle = screen.getByRole("button", { name: /^No date/ });
    const rows = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(within(rows as HTMLElement).getByRole("heading", { level: 3, name: /Home/ })).toBeTruthy();

    // Still saving, so the folded state shown is the optimistic one.
    vi.mocked(setNoDateCollapsedAction).mockReturnValue(new Promise(() => {}));
    const overdueSaves = vi.mocked(setOverdueCollapsedAction).mock.calls.length;
    fireEvent.click(toggle);
    expect(vi.mocked(setNoDateCollapsedAction)).toHaveBeenLastCalledWith(true);
    expect(vi.mocked(setOverdueCollapsedAction)).toHaveBeenCalledTimes(overdueSaves);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(rows?.hasAttribute("inert")).toBe(true);
    expect(rows?.contains(screen.getByText("Bins"))).toBe(false);
  });

  it("shows a list's first 10 undated items in No date, with their checklists, and the rest on asking", () => {
    const first = item("Undated 1", null);
    const items = [
      first,
      item("Step", null, { parentId: first.id }),
      ...Array.from({ length: 11 }, (_, k) => item(`Undated ${k + 2}`, null)),
    ];
    const buy = { ...home, id: "p2", name: "Buy", prefix: "BUY", refPrefix: "BUY" } as ProjectView;
    const buyItems = Array.from({ length: 11 }, (_, k) =>
      item(`Buy ${k + 1}`, null, { projectId: "p2" }),
    );
    renderAgenda([...items, ...buyItems], [home, buy]);
    const noDate = within(section(/^No date/));
    expect(noDate.getByText("Step")).toBeTruthy();
    expect(noDate.getByText("Undated 10")).toBeTruthy();
    expect(noDate.queryByText("Undated 11")).toBeNull();
    // The card's count is still all of them.
    expect(noDate.getByRole("heading", { level: 3, name: /Home/ }).textContent).toContain("13");

    fireEvent.click(noDate.getByRole("button", { name: "Show 2 more in Home" }));
    expect(noDate.getByText("Undated 12")).toBeTruthy();
    expect(noDate.queryByRole("button", { name: /more in Home$/ })).toBeNull();
    // Focus goes on to the first of the rest, not back to the top of the page.
    expect(document.activeElement).toBe(noDate.getByText("Undated 11").closest("button"));
    // Buy's card keeps its own 10.
    expect(noDate.queryByText("Buy 11")).toBeNull();
    expect(noDate.getByRole("button", { name: "Show 1 more in Buy" })).toBeTruthy();
  });

  // A long one renders only the rows near the Brief's view, as on the board,
  // without moving it.
  describe("a long section, with the Brief scrolled down to it", () => {
    // jsdom has no layout: give the Brief a height and scroll it 3000px down,
    // with the list 580px above the view's top (its first 10 rows, 52px each
    // and 6px apart, just off screen). Scrolling writes where it's read.
    let top = 3000;
    beforeEach(() => {
      top = 3000;
      const brief = (el: HTMLElement) => el.matches("[data-brief]");
      const mocks = [
        vi
          .spyOn(HTMLElement.prototype, "clientHeight", "get")
          .mockImplementation(function (this: HTMLElement) {
            return brief(this) ? 800 : 0;
          }),
        vi
          .spyOn(HTMLElement.prototype, "scrollTop", "get")
          .mockImplementation(function (this: HTMLElement) {
            return brief(this) ? top : 0;
          }),
        vi
          .spyOn(HTMLElement.prototype, "offsetHeight", "get")
          .mockImplementation(function (this: HTMLElement) {
            return this.matches("[data-index]") ? 52 : 0;
          }),
        vi
          .spyOn(HTMLElement.prototype, "getBoundingClientRect")
          .mockImplementation(function (this: HTMLElement) {
            const y = this.matches("[data-brief] .flow-root") ? -580 : 0;
            return { top: y, bottom: y, left: 0, right: 0, width: 0, height: 0, x: 0, y } as DOMRect;
          }),
      ];
      HTMLElement.prototype.scrollTo = function (this: HTMLElement, to?: ScrollToOptions | number) {
        if (brief(this) && typeof to === "object" && to.top !== undefined) top = to.top;
      } as HTMLElement["scrollTo"];
      // Reporting each element as it's observed, as a browser does.
      vi.stubGlobal(
        "ResizeObserver",
        class {
          report: ResizeObserverCallback;
          constructor(report: ResizeObserverCallback) {
            this.report = report;
          }
          observe() {
            this.report([], this as unknown as ResizeObserver);
          }
          unobserve() {
            return undefined;
          }
          disconnect() {
            return undefined;
          }
        },
      );
      return () => {
        mocks.forEach((m) => m.mockRestore());
        // @ts-expect-error jsdom has none
        delete HTMLElement.prototype.scrollTo;
        vi.unstubAllGlobals();
      };
    });

    it("shows a No date card's rest where its Show more was, focusing the first", () => {
      renderAgenda(Array.from({ length: 80 }, (_, k) => item(`Undated ${k + 1}`, null)));
      const noDate = within(section(/^No date/));
      fireEvent.click(noDate.getByRole("button", { name: "Show 70 more in Home" }));
      expect(top).toBe(3000);
      expect(document.activeElement).toBe(noDate.getByText("Undated 11").closest("button"));
      // On screen where the button was, down to the view's foot, and no further.
      expect(noDate.getByText("Undated 24")).toBeTruthy();
      expect(noDate.queryByText("Undated 50")).toBeNull();
    });

    it("unfolds Overdue on the rows in view", () => {
      renderAgenda(
        Array.from({ length: 80 }, (_, k) => item(`Late ${k + 1}`, "2026-11-10")),
        [home],
        true,
      );
      vi.mocked(setOverdueCollapsedAction).mockReturnValue(new Promise(() => {}));
      fireEvent.click(screen.getByRole("button", { name: /^Overdue/ }));
      expect(top).toBe(3000);
      expect(screen.getByText("Late 24")).toBeTruthy();
      expect(screen.queryByText("Late 50")).toBeNull();
    });
  });

  // A folded No date with hundreds of items shouldn't cost a render.
  it("unmounts a folded card's rows once the fold has closed", async () => {
    renderAgenda([item("Tidy flat", null)]);
    vi.mocked(setNoDateListFoldedAction).mockReturnValue(new Promise(() => {}));
    fireEvent.click(screen.getByRole("button", { name: /^Home/ }));
    expect(screen.getByText("Tidy flat")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Tidy flat")).toBeNull());
  });

  it("folds one list's card in No date at once and saves it, leaving the others open", () => {
    const buy = { ...home, id: "p2", name: "Buy", prefix: "BUY", refPrefix: "BUY" } as ProjectView;
    renderAgenda([item("Tidy flat", null), item("Slippers", null, { projectId: "p2" })], [home, buy]);
    const homeToggle = screen.getByRole("button", { name: /^Home/ });
    const homeRows = document.getElementById(homeToggle.getAttribute("aria-controls") ?? "");
    expect(homeRows?.textContent).toContain("Tidy flat");

    vi.mocked(setNoDateListFoldedAction).mockReturnValue(new Promise(() => {}));
    fireEvent.click(homeToggle);
    expect(vi.mocked(setNoDateListFoldedAction)).toHaveBeenLastCalledWith(home.id, true);
    expect(homeToggle.getAttribute("aria-expanded")).toBe("false");
    expect(homeRows?.hasAttribute("inert")).toBe(true);
    // Buy's card, and No date itself, stay open.
    const buyToggle = screen.getByRole("button", { name: /^Buy/ });
    expect(buyToggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: /^No date/ }).getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(buyToggle.getAttribute("aria-controls") ?? "")?.hasAttribute("inert")).toBe(false);
  });

  it("greets with chips that open their items, and a triage phrase that opens Overdue", async () => {
    const late = item("Call the bank", "2026-11-10");
    const bins = item("Bins", "2026-11-14");
    const loft = item("Sort the loft", null);
    vi.mocked(setOverdueCollapsedAction).mockReturnValue(new Promise(() => {}));
    vi.mocked(aiRead).mockResolvedValueOnce({
      hello: "Good afternoon, Fred.",
      text: `Since Friday you've finished {{item:gone}}. {{item:${late.id}}} is still waiting. No rush — want to {{action:triage|give it a new day}}? After that, {{others|one other}}.`,
      titles: { gone: "Renew passport", [late.id]: "Call the bank" },
      written: true,
      others: [
        { id: loft.id, title: "Sort the loft" },
        { id: "unloaded", title: "Paint the shed" },
      ],
    } satisfies Greeting);
    const onFeedback = vi.fn();
    renderAgenda([late, bins, loft], [home], true, true, onFeedback);
    const greeting = await screen.findByText(/^Since Friday/);
    expect(screen.getByRole("heading", { level: 2, name: "Good afternoon, Fred." })).toBeTruthy();
    expect(greeting.textContent).toBe(
      "Since Friday you've finished Renew passport. Call the bank is still waiting. No rush — want to give it a new day? After that, one other.",
    );
    // An item the page hasn't loaded is named, but isn't a button.
    expect(within(greeting).queryByRole("button", { name: "Renew passport" })).toBeNull();

    fireEvent.click(within(greeting).getByRole("button", { name: "give it a new day" }));
    expect(vi.mocked(setOverdueCollapsedAction)).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole("button", { name: /^Overdue/ }).getAttribute("aria-expanded")).toBe("true");

    // Hovering a chip lights up its row.
    const chip = within(greeting).getByRole("button", { name: "Call the bank" });
    fireEvent.pointerEnter(chip);
    const lit = () => section(/^Overdue/).querySelector("[data-lit]");
    expect(lit()?.textContent).toContain("Call the bank");
    fireEvent.pointerLeave(chip);
    expect(lit()).toBeNull();

    // A thumbs down sends what the reader saw, chips as their titles.
    fireEvent.click(screen.getByRole("button", { name: "Not quite right" }));
    expect(onFeedback).toHaveBeenCalledWith({
      area: "greeting",
      rating: "down",
      context:
        "Good afternoon, Fred. Since Friday you've finished Renew passport. Call the bank is still waiting. No rush — want to give it a new day? After that, one other.",
    });

    // The chips are inline in the sentence, and still work from the keyboard.
    // Space too, without scrolling the page.
    const space = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    within(greeting).getByRole("button", { name: "give it a new day" }).dispatchEvent(space);
    expect(space.defaultPrevented).toBe(true);
    fireEvent.keyDown(within(greeting).getByRole("button", { name: "one other" }), { key: "Enter" });
    // Named, but not a button: the page hasn't loaded it.
    expect(within(screen.getByRole("dialog")).getByText("Paint the shed").closest("button")).toBeNull();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Sort the loft" }));
    expect(within(screen.getByRole("dialog")).getByText(`P1-${loft.number}`)).toBeTruthy();
  });

  it("asks for the greeting again when an item it names changes, keeping it shown meanwhile", async () => {
    const late = item("Call the bank", "2026-11-10");
    const bins = item("Bins", "2026-11-14");
    const first = {
      hello: "Good morning, Fred.",
      text: `{{item:${late.id}}} is still waiting.`,
      titles: { [late.id]: "Call the bank" },
      written: true,
      others: [],
    } satisfies Greeting;
    let answer!: (g: Greeting) => void;
    vi.mocked(aiRead)
      .mockResolvedValueOnce(first)
      .mockReturnValueOnce(new Promise((r) => (answer = r)));
    const board = (items: Item[]) => (
      <AgendaView
        projects={[home]}
        itemsByProject={{ p1: items }}
        assigneesByProject={{}}
        prLinksByItem={{}}
        viewerId="me"
        overdueCollapsed={false}
        noDateCollapsed={false}
        noDateFoldedLists={[]}
        greet
        firstName="Fred"
      />
    );
    const { rerender } = render(board([late, bins]));
    await screen.findByText(/is still waiting\.$/);
    const calls = () => vi.mocked(aiRead).mock.calls.length;
    const before = calls();
    // Something it doesn't name changing doesn't ask.
    rerender(board([late, { ...bins, title: "Put the bins out" }]));
    await new Promise((r) => setTimeout(r, 1800));
    expect(calls()).toBe(before);
    // Ticking off what it names does, after a moment, and the greeting stays
    // until the new one comes.
    rerender(board([{ ...late, completedAt: 1 }, { ...bins, title: "Put the bins out" }]));
    // Faded and marked out of date at once, before it asks.
    await screen.findByText("Out of date");
    await waitFor(() => expect(calls()).toBe(before + 1), { timeout: 3000 });
    expect(screen.getByText("Rewriting…")).toBeTruthy();
    // Too soon to rewrite: the old one stays, counting down, with Rewrite now.
    let again!: (g: Greeting) => void;
    vi.mocked(aiRead).mockReturnValueOnce(new Promise((r) => (again = r)));
    await act(async () => answer({ ...first, retryInMs: 20_000 }));
    expect(screen.getByText("Out of date")).toBeTruthy();
    expect(screen.getByText(/· rewriting in (19|20)s$/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Rewrite now" }));
    expect(vi.mocked(aiRead)).toHaveBeenLastCalledWith("greeting", { now: true });
    // Still too soon: the retry it schedules keeps asking as "Rewrite now" did.
    let third!: (g: Greeting) => void;
    vi.mocked(aiRead).mockReturnValueOnce(new Promise((r) => (third = r)));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    try {
      await act(async () => again({ ...first, retryInMs: 3_000 }));
      await act(async () => vi.advanceTimersByTime(4_500));
    } finally {
      vi.useRealTimers();
    }
    expect(vi.mocked(aiRead)).toHaveBeenLastCalledWith("greeting", { now: true });
    await act(async () => third({ ...first, text: "That's everything for today.", titles: {} }));
    expect(screen.getByText("That's everything for today.").hasAttribute("aria-busy")).toBe(false);
    expect(screen.queryByRole("button", { name: "Rewrite now" })).toBeNull();
  });

  it("stops showing the greeting out of date when a change to what it names is undone before it asks", async () => {
    const late = item("Call the bank", "2026-11-10");
    vi.mocked(aiRead).mockResolvedValueOnce({
      hello: "Good morning, Fred.",
      text: `{{item:${late.id}}} is still waiting.`,
      titles: { [late.id]: "Call the bank" },
      written: true,
      others: [],
    } satisfies Greeting);
    const board = (items: Item[]) => (
      <AgendaView
        projects={[home]}
        itemsByProject={{ p1: items }}
        assigneesByProject={{}}
        prLinksByItem={{}}
        viewerId="me"
        overdueCollapsed={false}
        noDateCollapsed={false}
        noDateFoldedLists={[]}
        greet
        firstName="Fred"
      />
    );
    const { rerender } = render(board([late]));
    await screen.findByText(/is still waiting\.$/);
    const before = vi.mocked(aiRead).mock.calls.length;
    rerender(board([{ ...late, completedAt: 1 }]));
    await screen.findByText("Out of date");
    rerender(board([late]));
    await waitFor(() => expect(screen.queryByText("Out of date")).toBeNull());
    await new Promise((r) => setTimeout(r, 1800));
    expect(vi.mocked(aiRead).mock.calls.length).toBe(before);
  });

  it("asks again when told, from the built-in greeting too, without calling that out of date", async () => {
    const late = item("Call the bank", "2026-11-10");
    let second!: (g: Greeting) => void;
    vi.mocked(aiRead)
      .mockResolvedValueOnce({
        hello: "Good morning, Fred.",
        text: "One thing slipped.",
        titles: {},
        written: false,
        others: [],
        retryInMs: 15 * 60_000,
      } satisfies Greeting)
      .mockReturnValueOnce(new Promise((r) => (second = r)));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(new Date(2026, 10, 14, 12));
    try {
      renderAgenda([late], [home], false, true);
      await act(async () => {});
      expect(screen.getByText("One thing slipped.")).toBeTruthy();
      expect(screen.queryByText("Out of date")).toBeNull();
      expect(screen.queryByRole("button", { name: "Rewrite now" })).toBeNull();
      // Told 15 minutes, it checks back after 30s; not in a hidden tab
      // until it's seen again.
      const calls = () => vi.mocked(aiRead).mock.calls.length;
      const before = calls();
      await act(async () => vi.advanceTimersByTime(29_000));
      expect(calls()).toBe(before);
      const hidden = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      await act(async () => vi.advanceTimersByTime(2_000));
      expect(calls()).toBe(before);
      hidden.mockReturnValue("visible");
      await act(async () => document.dispatchEvent(new Event("visibilitychange")));
      hidden.mockRestore();
      expect(calls()).toBe(before + 1);
    } finally {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 10, 14, 12));
    }
    await act(async () =>
      second({
        hello: "Good morning, Fred.",
        text: `{{item:${late.id}}} is still waiting.`,
        titles: { [late.id]: "Call the bank" },
        written: true,
        others: [],
      }),
    );
    expect(screen.getByText(/is still waiting\.$/)).toBeTruthy();
  });

  it("adds for today from the + by the date", () => {
    const onAddForToday = vi.fn();
    render(
      <AgendaView
        projects={[home]}
        itemsByProject={{}}
        assigneesByProject={{}}
        prLinksByItem={{}}
        viewerId="me"
        overdueCollapsed={false}
        noDateCollapsed={false}
        noDateFoldedLists={[]}
        greet
        firstName="Fred"
        onAddForToday={onAddForToday}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add for today" }));
    expect(onAddForToday).toHaveBeenCalledTimes(1);
  });

  it("explains how the greeting was worked out", async () => {
    const late = item("Call the bank", "2026-11-10");
    const paid = item("Pay rent", "2026-11-14", doneOn(14));
    vi.mocked(aiRead).mockResolvedValueOnce({
      hello: "Good morning, Fred.",
      text: `{{item:${late.id}}} slipped.`,
      titles: { [late.id]: "Call the bank" },
      others: [],
      written: false,
      trace: {
        day: "2026-11-14",
        partOfDay: "morning",
        at: Date.UTC(2026, 10, 14, 9),
        timeZone: "UTC",
        why: "Claude's reply was turned down: it called something overdue or late",
        looked: { dueToday: 0, doneToday: 0, slipped: 1, undated: 2, stale: 0, finishedSince: 0, sinceDay: null },
        moments: [
          { moment: "triage", score: 0.42, said: true, why: "Always said when it applies" },
          { moment: "urgent", score: 0.55, said: false, why: "Scored under 0.6" },
        ],
        items: [
          { id: late.id, title: "Call the bank", list: "Home", score: 0.8, named: true, other: false },
          { id: "gone", title: "Paint the shed", list: "Home", score: 0.3, named: false, other: false },
          { id: paid.id, title: "Pay rent", list: "Home", score: 0.2, named: true, other: false },
        ],
        model: null,
      },
    });
    renderAgenda([late, paid], [home], false, true, vi.fn());
    await screen.findByText(/slipped\./);
    // The built-in greeting has no thumbs, but still explains itself.
    expect(screen.queryByRole("button", { name: "Good greeting" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "What is this?" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/turned down: it called something overdue or late/)).toBeTruthy();
    expect(within(dialog).getByText("1 slipped")).toBeTruthy();
    const said = within(dialog).getByText("What slipped").closest("li");
    expect(said?.hasAttribute("data-said")).toBe(true);
    expect(said?.textContent).toContain("42%");
    // The built-in greeting showed, so Claude's picks weren't said.
    expect(said?.textContent).toContain("picked: Always said when it applies");
    expect(within(dialog).getByText("What Claude was asked to say")).toBeTruthy();
    expect(within(dialog).getByText(/worked out at 09:00/)).toBeTruthy();
    const left = within(dialog).getByText("Something time-sensitive").closest("li");
    expect(left?.hasAttribute("data-said")).toBe(false);
    expect(left?.textContent).toContain("left out: Scored under 0.6");
    expect(within(dialog).getByText("Call the bank").closest("li")?.textContent).toContain("80%");
    // Finished since it was worked out: crossed out, as on the board.
    expect(within(dialog).getByText("Call the bank").className).not.toContain("line-through");
    expect(within(dialog).getByText("Pay rent").className).toContain("line-through");
    // Weighed but not loaded on the page: listed, but can't open.
    expect(within(dialog).getByText("Paint the shed").closest("button")).toBeNull();
    // An item opens in the same dialog, with a way back to the explanation.
    fireEvent.click(within(dialog).getByRole("button", { name: /Call the bank/ }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(within(screen.getByRole("dialog")).getByText(`P1-${late.number}`)).toBeTruthy();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Back to What is this?" }));
    expect(within(screen.getByRole("dialog")).getByText("Items it weighed")).toBeTruthy();
    expect(within(screen.getByRole("dialog")).queryByText(`P1-${late.number}`)).toBeNull();
  });

  it("keeps the opening line and drops the placeholder if the greeting can't load", async () => {
    vi.mocked(aiRead).mockRejectedValueOnce(new Error("offline"));
    const { container } = renderAgenda([], [home], false, true);
    expect(container.querySelector(".animate-pulse")).toBeTruthy();
    await vi.waitFor(() => expect(container.querySelector(".animate-pulse")).toBeNull());
    expect(screen.getByRole("heading", { level: 2, name: /^Good / })).toBeTruthy();
  });

  it("counts the greeting read when the viewer leaves it, not at a glance", () => {
    vi.mocked(setAgendaReadAction).mockClear();
    renderAgenda([], [home], false, true);
    cleanup();
    expect(vi.mocked(setAgendaReadAction)).not.toHaveBeenCalled();

    renderAgenda([], [home], false, true);
    vi.setSystemTime(Date.now() + 5000);
    cleanup();
    expect(vi.mocked(setAgendaReadAction)).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date(2026, 10, 14, 12));
  });

  it("stamps a read when the tab is hidden, but keeps showing the greeting it opened with", async () => {
    vi.mocked(setAgendaReadAction).mockClear();
    vi.mocked(aiRead).mockClear();
    vi.mocked(aiRead).mockResolvedValueOnce({
      hello: "Good morning, Fred.",
      text: "Since Friday you've finished four.",
      titles: {},
      others: [],
      written: false,
    });
    const { rerender } = renderAgenda([], [home], false, true);
    await screen.findByText("Since Friday you've finished four.");
    // The template's, so no thumbs: they rate Claude's.
    expect(screen.queryByRole("button", { name: "Good greeting" })).toBeNull();
    vi.setSystemTime(Date.now() + 5000);
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    expect(vi.mocked(setAgendaReadAction)).toHaveBeenCalledTimes(1);
    // The board reloads around it: the greeting isn't fetched again.
    rerender(
      <AgendaView
        projects={[home]}
        itemsByProject={{}}
        assigneesByProject={{}}
        prLinksByItem={{}}
        viewerId="me"
        overdueCollapsed={false}
        noDateCollapsed={false}
        noDateFoldedLists={[]}
        greet
        firstName="Fred"
      />,
    );
    expect(screen.getByText("Since Friday you've finished four.")).toBeTruthy();
    expect(vi.mocked(aiRead)).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date(2026, 10, 14, 12));
  });

  it("says when there's nothing to do", () => {
    renderAgenda([item("done", "2026-11-14", doneOn(13))]);
    expect(screen.getByText("Nothing to do.")).toBeTruthy();
  });
});
