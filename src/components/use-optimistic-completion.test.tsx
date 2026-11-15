// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { completeItemAction, uncompleteItemAction } from "@/app/actions";
import type { Item } from "@/core/schema";
import { useOptimisticCompletion } from "./use-optimistic-completion";

vi.mock("@/app/actions", () => ({
  completeItemAction: vi.fn(),
  uncompleteItemAction: vi.fn(),
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
  dueDate: null,
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
  const [byProject, setCompleted] = useOptimisticCompletion({ p1: items });
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

describe("useOptimisticCompletion", () => {
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
