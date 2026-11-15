// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PullToSearch } from "./PullToSearch";

afterEach(cleanup);

/** Drags one finger straight down the page by `distance` px and lets go. */
function pull(distance: number) {
  const x = 100;
  const y = 100;
  fireEvent.touchStart(document.body, { touches: [{ clientX: x, clientY: y }] });
  for (let d = 12; d <= distance; d += 12) {
    fireEvent.touchMove(document.body, { touches: [{ clientX: x, clientY: y + d }] });
  }
  fireEvent.touchEnd(document.body, { touches: [] });
}

describe("PullToSearch", () => {
  it("focuses an input before opening, so iOS raises the keyboard within the gesture", () => {
    let focusedOnOpen: Element | null = null;
    const onOpen = vi.fn(() => {
      focusedOnOpen = document.activeElement;
    });
    render(<PullToSearch onOpen={onOpen} />);

    pull(120);

    expect(onOpen).toHaveBeenCalledOnce();
    expect(focusedOnOpen).toBeInstanceOf(HTMLInputElement);
    // Once the palette takes focus, the stand-in is gone, so closing the
    // palette can't hand focus (and the keyboard) back to it.
    (focusedOnOpen as unknown as HTMLInputElement).blur();
    expect(document.querySelector("input")).toBeNull();
  });

  it("neither opens nor focuses anything for a pull short of the threshold", () => {
    const onOpen = vi.fn();
    render(<PullToSearch onOpen={onOpen} />);

    pull(48);

    expect(onOpen).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
    expect(document.querySelector("input")).toBeNull();
  });
});
