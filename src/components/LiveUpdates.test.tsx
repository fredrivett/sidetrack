// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveUpdates } from "./LiveUpdates";

const refreshIfCurrent = vi.hoisted(() => vi.fn());
vi.mock("@/components/LatestDeploy", () => ({ refreshIfCurrent }));
// The same router on every render, as Next's is.
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

/** The page's one stream. */
let stream: {
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  close: () => void;
};

beforeEach(() => {
  vi.useFakeTimers();
  refreshIfCurrent.mockClear();
  vi.stubGlobal(
    "EventSource",
    vi.fn(function () {
      stream = { close: vi.fn() };
      return stream;
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Hear `data` on the stream, and let the reload settle. */
function hear(data: string) {
  stream.onmessage?.({ data });
  vi.advanceTimersByTime(1000);
}

describe("LiveUpdates", () => {
  it("reloads for a change newer than the page, and skips one it already shows", () => {
    render(<LiveUpdates seq={10} />);
    hear("10");
    expect(refreshIfCurrent).not.toHaveBeenCalled();
    hear("11");
    expect(refreshIfCurrent).toHaveBeenCalledOnce();
  });

  it("skips this tab's own save, whose response renders the page past it before things settle", () => {
    const { rerender } = render(<LiveUpdates seq={10} />);
    // The save's event arrives first, then its response with the new page.
    stream.onmessage?.({ data: "12" });
    rerender(<LiveUpdates seq={12} />);
    vi.advanceTimersByTime(1000);
    expect(refreshIfCurrent).not.toHaveBeenCalled();
  });

  it("always reloads as the stream opens, for the changes it missed", () => {
    render(<LiveUpdates seq={10} />);
    stream.onopen?.();
    vi.advanceTimersByTime(1000);
    expect(refreshIfCurrent).toHaveBeenCalledOnce();
  });

  describe("with the board's rows", () => {
    const fetchMock = vi.fn();
    beforeEach(() => {
      fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ seq: 12, items: [], gone: ["a"] }) });
      vi.stubGlobal("fetch", fetchMock);
    });
    /** Rows the board holds as of these change numbers, and its saves' changes as (from, to]. */
    const board = (held: Record<string, number> = {}, saves: [number, number][] = []) => ({
      asOf: (id: string) => held[id] ?? -Infinity,
      own: (first: number, last: number) => saves.some(([from, to]) => first > from && last <= to),
      merge: vi.fn(),
    });

    it("reads just the rows a change was about, when they show all of it", async () => {
      const rows = board();
      render(<LiveUpdates seq={10} rows={rows} />);
      hear(JSON.stringify({ seq: 12, items: ["a", "b"], rows: true, first: 12 }));
      expect(refreshIfCurrent).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledWith("/api/items?ids=a,b");
      await vi.waitFor(() => expect(rows.merge).toHaveBeenCalledWith({ seq: 12, items: [], gone: ["a"] }));
    });

    it("skips this tab's own save, whose rows the board already holds, even when they don't show all of it", () => {
      render(<LiveUpdates seq={10} rows={board({ a: 12 }, [[11, 12]])} />);
      hear(JSON.stringify({ seq: 12, items: ["a"], rows: false, first: 12 }));
      hear(JSON.stringify({ seq: 12, items: ["a"], rows: true, first: 12 }));
      expect(refreshIfCurrent).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("reloads for someone else's comment on an item this tab has just saved", () => {
      // This tab's tick (13) is newer than the comment (12), but doesn't show it.
      render(<LiveUpdates seq={10} rows={board({ a: 13 }, [[12, 13]])} />);
      hear(JSON.stringify({ seq: 12, items: ["a"], rows: false, first: 12 }));
      expect(refreshIfCurrent).toHaveBeenCalledOnce();
    });

    it("reloads for a change the rows don't show all of, or one about more than items", () => {
      render(<LiveUpdates seq={10} rows={board({ a: 12 })} />);
      hear(JSON.stringify({ seq: 13, items: ["a"], rows: false, first: 13 }));
      expect(refreshIfCurrent).toHaveBeenCalledOnce();
      hear("14");
      expect(refreshIfCurrent).toHaveBeenCalledTimes(2);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("reloads when the rows can't be read", async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500 });
      render(<LiveUpdates seq={10} rows={board()} />);
      hear(JSON.stringify({ seq: 12, items: ["a"], rows: true, first: 12 }));
      await vi.waitFor(() => expect(refreshIfCurrent).toHaveBeenCalledOnce());
    });
  });
});
