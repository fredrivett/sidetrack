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
  it("names whose day someone sees, and only lets you show them everything instead", () => {
    const onChange = vi.fn();
    const props = {
      label: "What Jo can do",
      value: "viewer" as const,
      roles: ["member", "commenter", "viewer"] as const,
      scope: "space" as const,
      onChange: () => {},
    };
    render(<RoleSelect {...props} onlyMine={{ value: false, someoneElse: "@alex", onChange }} within="today" />);
    expect(screen.getByRole("button", { name: "What Jo can do" }).textContent).toBe("Can view, @alex’s day");
    open();
    const alex = screen.getByRole("menuitemcheckbox", { name: /^Only @alex’s day/ });
    expect(alex.getAttribute("aria-checked")).toBe("true");
    expect(screen.getAllByRole("menuitemcheckbox")).toHaveLength(1);
    fireEvent.click(alex);
    expect(onChange).toHaveBeenCalledExactlyOnceWith(false);

    // Not limited: nothing to limit them to here, that's Share your day's job.
    cleanup();
    render(<RoleSelect {...props} onlyMine={{ value: false, onChange }} />);
    expect(screen.getByRole("button", { name: "What Jo can do" }).textContent).toBe("Can view");
    open();
    expect(screen.queryAllByRole("menuitemcheckbox")).toHaveLength(0);
  });
});
