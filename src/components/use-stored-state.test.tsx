// @vitest-environment jsdom
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useStoredState } from "./use-stored-state";

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

const NONE: string[] = [];

describe("useStoredState", () => {
  it("comes back after the page does", () => {
    const first = renderHook(() => useStoredState("steps", NONE));
    act(() => first.result.current[1](["Buy milk"]));
    first.unmount();
    const second = renderHook(() => useStoredState("steps", NONE));
    expect(second.result.current[0]).toEqual(["Buy milk"]);
  });

  it("forgets the value once it's set back to the initial one", () => {
    const { result } = renderHook(() => useStoredState("title", ""));
    act(() => result.current[1]("Buy milk"));
    expect(localStorage.length).toBe(1);
    act(() => result.current[1](""));
    expect(localStorage.length).toBe(0);
    expect(result.current[0]).toBe("");
  });

  it("applies updates made together in turn, each to the one before", () => {
    const { result } = renderHook(() => useStoredState("count", 0));
    act(() => {
      result.current[1]((n) => n + 1);
      result.current[1]((n) => n + 1);
    });
    expect(result.current[0]).toBe(2);
  });

  it("keeps this tab's values apart from the ones every tab shares", () => {
    const { result } = renderHook(() => ({
      local: useStoredState("open", false),
      session: useStoredState("open", false, "session"),
    }));
    act(() => result.current.session[1](true));
    expect(result.current.session[0]).toBe(true);
    expect(result.current.local[0]).toBe(false);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(1);
  });

  it("shows every user of a key the same value", () => {
    const { result } = renderHook(() => [useStoredState("title", ""), useStoredState("title", "")]);
    act(() => result.current[0][1]("Buy milk"));
    expect(result.current[1][0]).toBe("Buy milk");
  });

  it("still works, for the page's life, when the browser won't store it", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Full", "QuotaExceededError");
    });
    // Its own key: the value stays in memory until a write is stored.
    const { result } = renderHook(() => useStoredState("unstorable", ""));
    act(() => result.current[1]("Buy milk"));
    expect(result.current[0]).toBe("Buy milk");
    act(() => result.current[1]((t) => `${t} and eggs`));
    expect(result.current[0]).toBe("Buy milk and eggs");
  });

  it("ignores a stored value it can't read", () => {
    localStorage.setItem("sidetrack:title", "{not json");
    const { result } = renderHook(() => useStoredState("title", "fallback"));
    expect(result.current[0]).toBe("fallback");
  });

  // The server can't see the browser's storage, so it and hydration must
  // render the initial value, or React reports a mismatch.
  it("renders the initial value on the server", () => {
    localStorage.setItem("sidetrack:title", JSON.stringify("Buy milk"));
    function Title() {
      return <p>{useStoredState("title", "none")[0]}</p>;
    }
    expect(renderToString(<Title />)).toBe("<p>none</p>");
    const { container } = render(<Title />);
    expect(container.textContent).toBe("Buy milk");
  });
});
