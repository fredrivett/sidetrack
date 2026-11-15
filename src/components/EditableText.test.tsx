// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EditableText } from "./EditableText";

afterEach(cleanup);

describe("EditableText", () => {
  it("shows the new text while it saves, and the old text again if the save fails", async () => {
    let settle!: (ok: boolean) => void;
    // As runAction resolves: true once saved, false after a failure.
    const onSave = () => new Promise<boolean>((resolve) => (settle = resolve));
    render(<EditableText value="Groceries" onSave={onSave} />);

    fireEvent.click(screen.getByRole("button", { name: "Groceries" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Food shop" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

    // Not the old text while it saves.
    expect(screen.getByRole("button").textContent).toBe("Food shop");

    await act(async () => settle(false));
    expect(screen.getByRole("button").textContent).toBe("Groceries");
  });

  it("with hold, keeps the saved text, marked as saving, until the save lands", async () => {
    let settle!: (ok: boolean) => void;
    const onSave = () => new Promise<boolean>((resolve) => (settle = resolve));
    render(<EditableText value="example.com" onSave={onSave} hold />);

    fireEvent.click(screen.getByRole("button", { name: "example.com" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "example.org" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

    // The server may clean it up or reject it, so not the typed text.
    const field = screen.getByRole("button");
    expect(field.textContent).toBe("example.com");
    expect(field.getAttribute("aria-busy")).toBe("true");
    // Can't start another edit meanwhile.
    fireEvent.click(field);
    expect(screen.queryByRole("textbox")).toBeNull();

    await act(async () => settle(true));
    expect(screen.getByRole("button").getAttribute("aria-busy")).toBeNull();
  });
});
