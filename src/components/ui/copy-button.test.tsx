// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopyButton } from "./copy-button";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

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
  vi.mocked(toast.error).mockClear();
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

  it("doesn't claim Copied for a new value that wasn't copied", async () => {
    stubClipboard(() => Promise.resolve());
    const { rerender } = render(<CopyButton value="sk_first">Copy</CopyButton>);

    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });
    expect(screen.getByRole("button").textContent).toBe("Copied");

    // A second key created within the 1.5s window.
    rerender(<CopyButton value="sk_second">Copy</CopyButton>);
    expect(screen.getByRole("button").textContent).toBe("Copy");
  });

  it("names an icon-only button Copied while copied", async () => {
    stubClipboard(() => Promise.resolve());
    render(<CopyButton value="https://x" aria-label="Copy payload url" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy payload url" }));
    });
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
  });

  it("shows an error and doesn't claim Copied when the write fails", async () => {
    stubClipboard(() => Promise.reject(new Error("denied")));
    render(<CopyButton value="sk_secret">Copy</CopyButton>);

    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });
    expect(screen.getByRole("button").textContent).toBe("Copy");
    expect(toast.error).toHaveBeenCalledWith("Couldn't copy to the clipboard.");
  });
});
