// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopyButton } from "./copy-button";

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn(writeText) },
    configurable: true,
  });
  return navigator.clipboard.writeText;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("CopyButton", () => {
  it("copies its value and shows Copied in place, then reverts", async () => {
    vi.useFakeTimers();
    const writeText = stubClipboard(() => Promise.resolve());
    render(<CopyButton value="sk_secret">Copy</CopyButton>);

    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });
    expect(writeText).toHaveBeenCalledWith("sk_secret");
    expect(screen.getByRole("button").textContent).toBe("Copied");

    act(() => vi.advanceTimersByTime(1500));
    expect(screen.getByRole("button").textContent).toBe("Copy");
  });

  it("doesn't claim Copied when the clipboard write fails", async () => {
    stubClipboard(() => Promise.reject(new Error("denied")));
    render(<CopyButton value="sk_secret">Copy</CopyButton>);

    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });
    expect(screen.getByRole("button").textContent).toBe("Copy");
  });
});
