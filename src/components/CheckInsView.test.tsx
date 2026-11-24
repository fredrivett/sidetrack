// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Item } from "@/core/schema";
import { CheckInsView, type MyDay } from "./CheckInsView";
import type { ProjectView } from "./Kanban";

// The server actions pull in server-only modules (next/cache, the DB).
vi.mock("@/app/actions", () => ({}));

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 24, 12));
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
});
afterAll(() => vi.useRealTimers());
afterEach(cleanup);

const home = { id: "p1", name: "Home", refPrefix: "HOM", icon: null, homepageUrl: null } as unknown as ProjectView;
let n = 0;
const item = (title: string, more: Partial<Item> = {}): Item => ({
  id: `i${++n}`,
  projectId: "p1",
  title,
  description: null,
  labels: [],
  assigneeIds: ["me"],
  createdBy: null,
  parentId: null,
  collapsed: false,
  dueDate: "2026-11-24",
  dueFrom: null,
  repeatEvery: null,
  repeatUnit: null,
  repeatOn: null,
  repeatDay: null,
  smartRule: null,
  smartLead: null,
  somedayAt: null,
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

describe("CheckInsView", () => {
  it("shows and counts each item and sub-item in the day, leaving out steps due another day or finished before it", () => {
    const plan = item("Sort the hall");
    // Due at the weekend, with one step due today: it holds that step, uncounted.
    const pile = item("Sort the storage pile", { dueFrom: "2026-11-28", dueDate: "2026-11-29" });
    const items = [
      pile,
      item("Make a list", { parentId: pile.id }),
      item("Look at storage", { parentId: pile.id, dueDate: null }),
      item("Due next week", { parentId: plan.id, dueDate: "2026-12-01" }),
      // Undated under an item due today, overdue, or a span begun today: in it.
      item("Undated step", { parentId: plan.id, dueDate: null }),
      item("Late errand", { dueDate: "2026-11-20" }),
      item("Span", { dueFrom: "2026-11-24", dueDate: "2026-11-30" }),
      plan,
      item("Done last week", { parentId: plan.id, ...doneOn(17) }),
      item("Done today", { parentId: plan.id, ...doneOn(24) }),
      item("Still to do", { parentId: plan.id }),
      item("Put up washing", doneOn(24)),
      item("Cancelled", { cancelled: true, ...doneOn(24) }),
    ];
    const myDay: MyDay = {
      within: "today",
      day: "2026-11-24",
      startsAt: new Date(2026, 10, 24, 4).getTime(),
      today: "2026-11-24",
      note: null,
      mood: [],
      wrapUp: null,
      itemIds: items.map((i) => i.id),
      shares: [],
      invited: [],
    };
    render(
      <CheckInsView
        checkIns={[]}
        myDay={myDay}
        viewer={{ name: "Me", username: "me", image: null }}
        itemsByProject={{ p1: items }}
        projectsById={new Map([["p1", home]])}
        assigneesByProject={{}}
        prLinksByItem={{}}
        parentTitles={{}}
        viewerId="me"
        onShareDay={() => {}}
      />,
    );
    const day = within(screen.getByRole("region", { name: "Your day" }));
    // The hall and its three steps in today, the washing, the overdue item,
    // the span, and the pile's step due today: two of them done.
    expect(day.getByText("2 of 8 done")).toBeTruthy();
    expect(day.getByRole("progressbar")).toHaveProperty("ariaValueMax", "8");
    for (const shown of ["Sort the storage pile", "Make a list", "Done today", "Still to do", "Undated step", "Late errand", "Span"]) {
      expect(day.getByText(shown)).toBeTruthy();
    }
    // The pile's checklist still counts both its steps, though one is off the card.
    expect(day.getByLabelText(/checklist, 0 of 2 done/)).toBeTruthy();
    // Undated under a weekend item, due next week, or done last week: not today's.
    for (const hidden of ["Look at storage", "Due next week", "Done last week"]) expect(day.queryByText(hidden)).toBeNull();
  });
});
