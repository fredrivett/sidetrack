// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import {
  completeItemAction,
  deleteItemAction,
  setItemParentAction,
  uncompleteItemAction,
} from "@/app/actions";
import type { Item } from "@/core/schema";
import { nestItems } from "@/lib/itemTree";
import { type ItemChanges, useOptimisticItems } from "./use-optimistic-items";

vi.mock("@/app/actions", () => ({
  completeItemAction: vi.fn(),
  uncompleteItemAction: vi.fn(),
  deleteItemAction: vi.fn(),
  setItemParentAction: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const base: Item = {
  id: "",
  projectId: "p1",
  title: "",
  description: null,
  category: null,
  assigneeIds: [],
  parentId: null,
  collapsed: false,
  dueDate: null,
  dueFrom: null,
  repeatEvery: null,
  repeatUnit: null,
  position: "a0",
  number: 1,
  completedAt: null,
  createdAt: 0,
};
const parent = { ...base, id: "parent", title: "Parent" };
const open = { ...base, id: "open", title: "Open child", parentId: "parent" };
const other = { ...base, id: "other", title: "Other" };

/** Lists each item with whether it shows as done; clicking one toggles it. */
function Board({ items }: { items: Item[] }) {
  const [byProject, { setCompleted }] = useOptimisticItems({ p1: items });
  return (
    <>
      {byProject.p1.map((i) => (
        <button
          key={i.id}
          type="button"
          onClick={() => setCompleted(i, i.completedAt === null)}
        >
          {i.title}: {i.completedAt === null ? "open" : "done"}
        </button>
      ))}
    </>
  );
}

/** A save that stays in flight until the test settles it. */
function deferred() {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<never>((res, rej) => {
    resolve = res as () => void;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useOptimisticItems: ticks", () => {
  it("shows a tick, with the parent's open sub-items, before the save lands", async () => {
    const save = deferred();
    vi.mocked(completeItemAction).mockReturnValue(save.promise);
    render(<Board items={[parent, open, other]} />);

    fireEvent.click(screen.getByText("Parent: open"));

    expect(completeItemAction).toHaveBeenCalledWith("parent");
    screen.getByText("Parent: done");
    screen.getByText("Open child: done");
    screen.getByText("Other: open");
    // React holds every optimistic update until all pending saves settle.
    await act(async () => save.resolve());
  });

  it("unticks on a second tap made before the first save lands", async () => {
    const complete = deferred();
    const reopen = deferred();
    vi.mocked(completeItemAction).mockReturnValue(complete.promise);
    vi.mocked(uncompleteItemAction).mockReturnValue(reopen.promise);
    render(<Board items={[other]} />);

    fireEvent.click(screen.getByText("Other: open"));
    fireEvent.click(screen.getByText("Other: done"));

    expect(completeItemAction).toHaveBeenCalledTimes(1);
    expect(uncompleteItemAction).toHaveBeenCalledTimes(1);
    expect(uncompleteItemAction).toHaveBeenCalledWith("other");
    screen.getByText("Other: open");
    await act(async () => {
      complete.resolve();
      reopen.resolve();
    });
  });

  it("reopens a finished parent with its sub-item, as the server does", async () => {
    const save = deferred();
    vi.mocked(uncompleteItemAction).mockReturnValue(save.promise);
    render(
      <Board
        items={[
          { ...parent, completedAt: 1 },
          { ...open, completedAt: 1 },
        ]}
      />,
    );

    fireEvent.click(screen.getByText("Open child: done"));

    screen.getByText("Open child: open");
    screen.getByText("Parent: open");
    await act(async () => save.resolve());
  });

  it("completes the parent with its last open sub-item, as the server does", async () => {
    const first = deferred();
    const last = deferred();
    vi.mocked(completeItemAction)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(last.promise);
    const second = { ...open, id: "second", title: "Second child" };
    render(<Board items={[parent, open, second, other]} />);

    fireEvent.click(screen.getByText("Open child: open"));
    screen.getByText("Parent: open");
    fireEvent.click(screen.getByText("Second child: open"));
    screen.getByText("Parent: done");
    screen.getByText("Other: open");
    // The server completes the parent itself; the client saves only the ticks.
    expect(vi.mocked(completeItemAction).mock.calls).toEqual([["open"], ["second"]]);
    await act(async () => {
      first.resolve();
      last.resolve();
    });
  });

  it("undoes the tick and says so when the save fails", async () => {
    const save = deferred();
    vi.mocked(completeItemAction).mockReturnValue(save.promise);
    render(<Board items={[other]} />);

    fireEvent.click(screen.getByText("Other: open"));
    screen.getByText("Other: done");

    await act(async () => save.reject(new Error("Failed to fetch")));

    screen.getByText("Other: open");
    expect(toast.error).toHaveBeenCalledWith(
      "Couldn't complete “Other”. Please try again.",
    );
  });
});

/** The list as the board shows it: top-level items, each sub-item indented. */
function Tree({ items, onChanges }: { items: Item[]; onChanges: (c: ItemChanges) => void }) {
  const [byProject, c] = useOptimisticItems({ p1: items });
  useEffect(() => onChanges(c), [c, onChanges]);
  return (
    <ol>
      {nestItems(byProject.p1).flatMap((g) => [
        <li key={g.id}>{g.title}</li>,
        ...g.children.map((k) => <li key={k.id}>- {k.title}</li>),
      ])}
    </ol>
  );
}
const shown = () => screen.getAllByRole("listitem").map((li) => li.textContent);
let changes: ItemChanges;
const keep = (c: ItemChanges) => {
  changes = c;
};

describe("useOptimisticItems: deletes and moves", () => {
  const a = { ...base, id: "a", title: "A" };
  const a1 = { ...base, id: "a1", title: "A1", parentId: "a" };
  const a2 = { ...base, id: "a2", title: "A2", parentId: "a" };
  const b = { ...base, id: "b", title: "B" };
  const c = { ...base, id: "c", title: "C" };

  it("takes a parent and its sub-items off at once, and puts them back if the delete fails", async () => {
    const save = deferred();
    vi.mocked(deleteItemAction).mockReturnValue(save.promise);
    render(<Tree items={[a, a1, b]} onChanges={keep} />);

    act(() => changes.deleteItem(a));
    expect(shown()).toEqual(["B"]);

    await act(async () => save.reject(new Error("Failed to fetch")));
    expect(shown()).toEqual(["A", "- A1", "B"]);
    expect(toast.error).toHaveBeenCalledWith("Couldn't delete “A”. Please try again.");
  });

  it("nests last among the parent's sub-items, and moves out to just after the old parent", async () => {
    const save = deferred();
    vi.mocked(setItemParentAction).mockReturnValue(save.promise);
    render(<Tree items={[a, a1, a2, b, c]} onChanges={keep} />);

    // Where the server puts them (setItemParent without a position).
    act(() => changes.setParent(c, "a"));
    expect(shown()).toEqual(["A", "- A1", "- A2", "- C", "B"]);
    act(() => changes.setParent(a1, null));
    expect(shown()).toEqual(["A", "- A2", "- C", "A1", "B"]);
    expect(vi.mocked(setItemParentAction).mock.calls).toEqual([
      ["c", "a"],
      ["a1", null],
    ]);
    await act(async () => save.resolve());
  });

  it("moves out to just after the old parent when its sub-items interleave with other items", async () => {
    // Each level numbers its own positions, so a list sorted by position
    // across both can put the parent's last sub-item after other top-level items.
    // Sorted by position, then id: A a0, A1 a0, B a1, A2 a2, A3 a3, C a4.
    const at = (item: Item, position: string) => ({ ...item, position });
    const a3 = { ...base, id: "a3", title: "A3", parentId: "a", position: "a3" };
    const save = deferred();
    vi.mocked(setItemParentAction).mockReturnValue(save.promise);
    render(
      <Tree
        items={[at(a, "a0"), at(a1, "a0"), at(b, "a1"), at(a2, "a2"), a3, at(c, "a4")]}
        onChanges={keep}
      />,
    );

    act(() => changes.setParent(a3, null));
    expect(shown()).toEqual(["A", "- A1", "- A2", "A3", "B", "C"]);
    await act(async () => save.resolve());
  });
});
