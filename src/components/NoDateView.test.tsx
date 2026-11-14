// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Item } from "@/core/schema";
import type { ProjectView } from "./Kanban";
import { NoDateView } from "./NoDateView";

// The server actions pull in server-only modules (next/cache, the DB).
vi.mock("@/app/actions", () => ({
  completeItemAction: vi.fn(),
  uncompleteItemAction: vi.fn(),
  deleteItemAction: vi.fn(),
  updateItemAction: vi.fn(),
  setItemParentAction: vi.fn(),
  reorderItemAction: vi.fn(),
}));

beforeAll(() => {
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
let n = 0;
const item = (projectId: string, title: string, more: Partial<Item> = {}): Item => ({
  id: `i${++n}`,
  projectId,
  kind: "task",
  title,
  description: null,
  category: null,
  assigneeId: null,
  parentId: null,
  dueDate: null,
  position: `a${n}`,
  number: n,
  completedAt: null,
  createdAt: 0,
  ...more,
});

describe("NoDateView", () => {
  it("groups undated tasks by list and keeps a filtered sub-item with its parent named", () => {
    const tidy = item("home", "Tidy flat");
    const kitchen = item("home", "Kitchen", { parentId: tidy.id, assigneeId: "me" });
    const plan = item("home", "Phone plan", { dueDate: "2026-11-18" });
    render(
      <NoDateView
        projects={[list("home", "Home"), list("buy", "Buy")]}
        itemsByProject={{
          home: [tidy, kitchen, plan, item("home", "Fred's SIM", { parentId: plan.id })],
          buy: [item("buy", "Slippers")],
        }}
        assigneesByProject={{}}
        prLinksByItem={{}}
        viewerId="me"
      />,
    );

    const home = screen.getByRole("heading", { name: /Home/ }).closest("section") as HTMLElement;
    expect(within(home).getByText("Tidy flat")).toBeTruthy();
    expect(within(home).getByText("Kitchen")).toBeTruthy();
    // A dated parent's checklist is planned with it.
    expect(screen.queryByText("Phone plan")).toBeNull();
    expect(screen.queryByText("Fred's SIM")).toBeNull();
    expect(screen.getByRole("heading", { name: /Buy/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Mine/ }));
    expect(screen.queryByRole("heading", { name: /Buy/ })).toBeNull();
    // Its parent is filtered out, so only the sub-item's row shows, naming it.
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.getByText("Kitchen").parentElement?.textContent).toContain("Tidy flat");
  });
});
