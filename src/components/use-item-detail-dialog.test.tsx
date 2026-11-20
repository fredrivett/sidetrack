// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Item } from "@/core/schema";
import { useItemDetailDialog } from "./use-item-detail-dialog";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

const items = [
  { id: "a", title: "Water plants" },
  { id: "b", title: "Refill salt" },
] as Item[];

/** A list's dialog and the board's, as on the page. */
const page = (initialItemId: string | null = null) =>
  renderHook(() => ({
    list: useItemDetailDialog(items),
    board: useItemDetailDialog(items, initialItemId, true),
  }));

describe("useItemDetailDialog", () => {
  it("reopens the item that was open, in the board's dialog, after a reload", () => {
    const first = page();
    act(() => first.result.current.list.openDetail(items[0]));
    // Opened in the list's dialog: the board's doesn't open it too.
    expect(first.result.current.board.open).toBe(false);
    act(() => first.result.current.list.goTo(items[1]));
    first.unmount();

    const second = page();
    expect(second.result.current.board.item?.id).toBe("b");
    expect(second.result.current.board.open).toBe(true);
    expect(second.result.current.list.open).toBe(false);
  });

  it("reopens nothing once the dialog was closed", () => {
    const first = page();
    act(() => first.result.current.list.openDetail(items[0]));
    act(() => first.result.current.list.onOpenChange(false));
    first.unmount();
    expect(page().result.current.board.open).toBe(false);
  });

  it("opens a link's item rather than the one open before", () => {
    const first = page();
    act(() => first.result.current.list.openDetail(items[0]));
    first.unmount();
    expect(page("b").result.current.board.item?.id).toBe("b");
  });

  it("reopens nothing when the item has gone", () => {
    const first = page();
    act(() => first.result.current.list.openDetail({ id: "gone" } as Item));
    first.unmount();
    expect(page().result.current.board.open).toBe(false);
  });
});
