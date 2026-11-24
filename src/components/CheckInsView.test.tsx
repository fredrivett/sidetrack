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
  it("counts each item and sub-item in the day's progress, leaving out ones finished before it", () => {
    const plan = item("Sort the hall");
    const items = [
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
    // The item, its two steps still in today, and the washing: two of them done.
    expect(day.getByText("2 of 4 done")).toBeTruthy();
    expect(day.getByRole("progressbar")).toHaveProperty("ariaValueMax", "4");
  });
});
