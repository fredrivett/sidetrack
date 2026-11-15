// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTapToConfirm } from "./use-tap-to-confirm";

afterEach(() => vi.useRealTimers());

describe("useTapToConfirm", () => {
  it("runs only on the second tap of the same button", () => {
    const run = vi.fn();
    const { result } = renderHook(() => useTapToConfirm());
    act(() => result.current.confirm(run, "a"));
    expect(run).not.toHaveBeenCalled();
    expect(result.current.isArmed("a")).toBe(true);

    // Tapping another row's button moves the armed state there instead.
    act(() => result.current.confirm(run, "b"));
    expect(run).not.toHaveBeenCalled();
    expect(result.current.isArmed("a")).toBe(false);

    act(() => result.current.confirm(run, "b"));
    expect(run).toHaveBeenCalledTimes(1);
    expect(result.current.isArmed("b")).toBe(false);
  });

  it("disarms after a pause, so a later tap starts over", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const { result } = renderHook(() => useTapToConfirm());
    act(() => result.current.confirm(run));
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.isArmed()).toBe(false);
    act(() => result.current.confirm(run));
    expect(run).not.toHaveBeenCalled();
  });
});
