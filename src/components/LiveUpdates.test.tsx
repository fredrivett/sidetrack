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
});
