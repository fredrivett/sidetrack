// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { claimDrafts, forgetDrafts, useDraft } from "./use-draft";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
});

describe("useDraft", () => {
  it("comes back after a reload, until it's cleared", () => {
    const first = renderHook(() => useDraft("item:a:comment"));
    act(() => first.result.current.set("Looks good"));
    first.unmount();
    const second = renderHook(() => useDraft("item:a:comment"));
    expect(second.result.current.value).toBe("Looks good");
    act(() => second.result.current.clear());
    second.unmount();
    expect(renderHook(() => useDraft("item:a:comment")).result.current.value).toBe("");
  });

  // An edit is written against the saved text. Once that changes (someone
  // else edited it, or this edit was saved), putting the draft back would
  // overwrite it.
  it("drops an edit whose saved text has changed since", () => {
    const first = renderHook(() => useDraft("item:a:title", "Water plants"));
    expect(first.result.current.value).toBe("Water plants");
    act(() => first.result.current.set("Water the ferns"));
    first.unmount();
    expect(renderHook(() => useDraft("item:a:title", "Water plants")).result.current.value).toBe(
      "Water the ferns",
    );
    expect(renderHook(() => useDraft("item:a:title", "Feed the cat")).result.current.value).toBe(
      "Feed the cat",
    );
  });

  it("keeps nothing once it's back to the saved text", () => {
    const { result } = renderHook(() => useDraft("item:a:title", "Water plants"));
    act(() => result.current.set("Water"));
    expect(localStorage.length).toBe(1);
    act(() => result.current.set("Water plants"));
    expect(localStorage.length).toBe(0);
  });

  it("with no key, is plain state that a reload loses", () => {
    const first = renderHook(() => useDraft(null));
    act(() => first.result.current.set((t) => `${t}Hello`));
    act(() => first.result.current.set((t) => `${t} there`));
    expect(first.result.current.value).toBe("Hello there");
    expect(localStorage.length).toBe(0);
    first.unmount();
    expect(renderHook(() => useDraft(null)).result.current.value).toBe("");
  });
});

describe("claimDrafts", () => {
  function write(key: string, text: string) {
    const { result, unmount } = renderHook(() => useDraft(key));
    act(() => result.current.set(text));
    unmount();
  }
  const read = (key: string) => renderHook(() => useDraft(key)).result.current.value;

  it("keeps the user's own drafts, and drops someone else's", () => {
    claimDrafts("me");
    write("item:a:comment", "Mine");
    claimDrafts("me");
    expect(read("item:a:comment")).toBe("Mine");
    claimDrafts("someone-else");
    expect(read("item:a:comment")).toBe("");
  });

  it("drops drafts left untouched for a week", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 1));
    claimDrafts("me");
    write("item:old:comment", "Old");
    vi.setSystemTime(new Date(2026, 10, 7));
    write("item:new:comment", "New");
    vi.setSystemTime(new Date(2026, 10, 9));
    claimDrafts("me");
    expect(read("item:old:comment")).toBe("");
    expect(read("item:new:comment")).toBe("New");
  });

  it("leaves storage that isn't a draft alone, and signing out drops every draft", () => {
    localStorage.setItem("sidetrack:emoji-skin-tone", "1");
    claimDrafts("me");
    write("item:a:comment", "Mine");
    forgetDrafts();
    expect(read("item:a:comment")).toBe("");
    expect(localStorage.getItem("sidetrack:emoji-skin-tone")).toBe("1");
  });
});
