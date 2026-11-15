import { redirect } from "next/navigation";
import posthog from "posthog-js";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runAction } from "./run-action";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("posthog-js", () => ({ default: { captureException: vi.fn() } }));

afterEach(() => vi.clearAllMocks());

describe("runAction", () => {
  it("says what failed and resolves false, so callers can stop", async () => {
    const failure = new Error("Failed to fetch");
    const ok = await runAction(Promise.reject(failure), "rename “Home”");
    expect(ok).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("Couldn't rename “Home”. Please try again.");
    expect(posthog.captureException).toHaveBeenCalledWith(failure);
  });

  it("lets Next's redirect to /login through instead of calling it a failure", async () => {
    let signedOut: unknown;
    try {
      redirect("/login");
    } catch (e) {
      signedOut = e;
    }
    await expect(runAction(Promise.reject(signedOut), "rename “Home”")).rejects.toBe(signedOut);
    expect(toast.error).not.toHaveBeenCalled();
    expect(posthog.captureException).not.toHaveBeenCalled();
  });
});
