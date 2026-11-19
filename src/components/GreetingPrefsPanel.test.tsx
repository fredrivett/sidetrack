// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setGreetingPrefsAction } from "@/app/actions";
import { DEFAULT_GREETING_PREFS, parseGreetingPrefs } from "@/lib/greetingPrefs";
import { GreetingPrefsPanel } from "./GreetingPrefsPanel";

vi.mock("@/app/actions", () => ({ setGreetingPrefsAction: vi.fn() }));
vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("GreetingPrefsPanel", () => {
  it("keeps a draft note while the length or sharing is saved, and saves the note on its own", async () => {
    const save = vi.mocked(setGreetingPrefsAction).mockImplementation(async (p) => parseGreetingPrefs(p));
    render(<GreetingPrefsPanel initial={DEFAULT_GREETING_PREFS} />);
    const note = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(note, { target: { value: "Keep it brief." } });

    await act(async () => fireEvent.click(screen.getByRole("checkbox")));
    await act(async () => fireEvent.click(screen.getByRole("radio", { name: "Short" })));
    expect(note.value).toBe("Keep it brief.");
    // Neither sent the draft: the note is saved only from Save note.
    expect(save.mock.calls.map(([p]) => p)).toEqual([
      { length: "long", note: "", shareNote: false },
      { length: "short", note: "", shareNote: false },
    ]);

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save note" })));
    expect(save).toHaveBeenLastCalledWith({ length: "short", note: "Keep it brief.", shareNote: false });
    expect(screen.getByRole("radio", { name: "Short" }).getAttribute("aria-checked")).toBe("true");
  });
});
