// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoleSelect } from "./RoleSelect";

afterEach(cleanup);

function open() {
  const trigger = screen.getByRole("button", { name: "What Jo can do" });
  fireEvent.pointerDown(trigger);
  fireEvent.click(trigger);
}

describe("RoleSelect", () => {
  it("names whose items someone sees when another admin limited them, and lets you switch or lift it", () => {
    const onChange = vi.fn();
    const props = {
      label: "What Jo can do",
      value: "viewer" as const,
      roles: ["member", "commenter", "viewer"] as const,
      scope: "space" as const,
      onChange: () => {},
    };
    render(<RoleSelect {...props} onlyMine={{ value: false, someoneElse: "@alex", onChange }} />);
    expect(screen.getByRole("button", { name: "What Jo can do" }).textContent).toBe("Can view, @alex’s items");
    open();
    const alex = screen.getByRole("menuitemcheckbox", { name: /^Only @alex’s items/ });
    const mine = screen.getByRole("menuitemcheckbox", { name: /^Only my items/ });
    expect([alex.getAttribute("aria-checked"), mine.getAttribute("aria-checked")]).toEqual(["true", "false"]);
    fireEvent.click(mine);
    expect(onChange).toHaveBeenLastCalledWith(true);
    // A tick keeps the menu open.
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /^Only @alex’s items/ }));
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(onChange).toHaveBeenCalledTimes(2);

    // Limited to you: no one else is named.
    cleanup();
    render(<RoleSelect {...props} onlyMine={{ value: true, onChange }} />);
    expect(screen.getByRole("button", { name: "What Jo can do" }).textContent).toBe("Can view, my items");
    open();
    expect(screen.getAllByRole("menuitemcheckbox")).toHaveLength(1);
  });
});
