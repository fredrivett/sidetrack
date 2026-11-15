// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { redirect } from "next/navigation";
import { Component, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiKeyAction } from "@/app/actions";
import { ApiKeysPanel } from "./ApiKeysPanel";

vi.mock("@/app/actions", () => ({
  createApiKeyAction: vi.fn(),
  revokeApiKeyAction: vi.fn(),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: vi.fn() }),
}));

afterEach(cleanup);

/** Stands in for Next's redirect boundary, which a rethrown redirect reaches. */
type Caught = { error: { digest?: string } | null };
class Boundary extends Component<{ children: ReactNode }, Caught> {
  state: Caught = { error: null };
  static getDerivedStateFromError(error: Caught["error"]) {
    return { error };
  }
  render() {
    const { error } = this.state;
    return error ? <p>Caught {error.digest}</p> : this.props.children;
  }
}

describe("ApiKeysPanel", () => {
  it("lets a signed-out session's redirect to login through instead of showing it as an error", async () => {
    let toLogin: unknown;
    try {
      redirect("/login");
    } catch (e) {
      toLogin = e;
    }
    vi.mocked(createApiKeyAction).mockRejectedValue(toLogin);
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <Boundary>
        <ApiKeysPanel initial={[]} />
      </Boundary>,
    );

    fireEvent.change(screen.getByPlaceholderText(/claude\.ai connector/), { target: { value: "Laptop" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create" }));
    });

    expect(screen.getByText(/^Caught NEXT_REDIRECT/)).toBeTruthy();
  });
});
