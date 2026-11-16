// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { moveItemAction, previewMoveItemAction } from "@/app/actions";
import type { MovePlan } from "@/core/move";
import type { Item } from "@/core/schema";
import { MoveItemDialog } from "./MoveItem";

// Server actions pull in server-only modules; the sheet only needs stubs.
vi.mock("@/app/actions", () => ({
  previewMoveItemAction: vi.fn(),
  moveItemAction: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

beforeAll(() => {
  // base-ui's dialog observes resize, and the dialog picks desktop or drawer
  // by a media query; jsdom has neither.
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
  window.matchMedia ??= ((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
});

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
});

const item = { id: "i1", projectId: "p1", title: "Fix login" } as Item;
const plan = (over: Partial<MovePlan> = {}): MovePlan => ({
  from: { id: "p1", name: "Engineering" },
  to: { id: "p2", name: "Ops" },
  refs: [{ id: "i1", title: "Fix login", from: "ENG-2", to: "OPS-3" }],
  matchedLabels: [],
  missingLabels: [{ name: "Frontend", itemIds: ["i1"] }],
  unassigned: [],
  token: "t1",
  ...over,
});

async function open(position?: string) {
  render(<MoveItemDialog request={{ item, projectId: "p2", position }} onClose={() => {}} />);
  await screen.findByText("OPS-3");
}

describe("MoveItemDialog", () => {
  it("asks what to do with missing labels before moving, then moves with the preview's token", async () => {
    vi.mocked(previewMoveItemAction).mockResolvedValue(plan());
    vi.mocked(moveItemAction).mockResolvedValue({
      moved: true,
      plan: plan()
    });
    await open("after:i9");

    const move = screen.getByRole("button", { name: "Move" });
    expect(move.getAttribute("aria-disabled")).toBe("true");
    await act(async () => fireEvent.click(move));
    expect(moveItemAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("radio", { name: "Remove" }));
    await act(async () => fireEvent.click(move));
    // Where it was dropped, if it was dragged there.
    expect(moveItemAction).toHaveBeenCalledWith("i1", "p2", "t1", { Frontend: "drop" }, "after:i9");
    expect(toast).toHaveBeenCalledWith("Moved “Fix login” to Ops as OPS-3");
  });

  it("asks about each of several missing labels, with a shortcut for all", async () => {
    vi.mocked(previewMoveItemAction).mockResolvedValue(
      plan({
        missingLabels: [
          { name: "Frontend", itemIds: ["i1"] },
          { name: "urgent", itemIds: ["i1"] },
        ],
      }),
    );
    vi.mocked(moveItemAction).mockResolvedValue({ moved: true, plan: plan() });
    await open();
    const move = screen.getByRole("button", { name: "Move" });

    // One label decided isn't enough.
    const urgent = screen.getByRole("radiogroup", { name: "“urgent”" });
    fireEvent.click(within(urgent).getByRole("radio", { name: "Remove" }));
    await act(async () => fireEvent.click(move));
    expect(moveItemAction).not.toHaveBeenCalled();

    // Add all, then take urgent back off.
    fireEvent.click(screen.getByRole("button", { name: "Add all" }));
    fireEvent.click(within(urgent).getByRole("radio", { name: "Remove" }));
    await act(async () => fireEvent.click(move));
    expect(moveItemAction).toHaveBeenCalledWith("i1", "p2", "t1", {
      Frontend: "create",
      urgent: "drop",
    }, undefined);
  });

  it("shows the move as it is now when it changed since the preview", async () => {
    vi.mocked(previewMoveItemAction).mockResolvedValue(plan({ missingLabels: [] }));
    vi.mocked(moveItemAction).mockResolvedValueOnce({
      moved: false,
      plan: plan({
        refs: [{ id: "i1", title: "Fix login", from: "ENG-2", to: "OPS-4" }],
        missingLabels: [],
        token: "t2",
      }),
    });
    await open();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Move" })));
    expect(screen.getByText(/Something changed since this opened/)).toBeTruthy();
    expect(screen.getByText("OPS-4")).toBeTruthy();

    // Confirming again uses the new preview.
    vi.mocked(moveItemAction).mockResolvedValueOnce({ moved: true, plan: plan() });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Move" })));
    expect(moveItemAction).toHaveBeenLastCalledWith("i1", "p2", "t2", undefined, undefined);
  });
});
