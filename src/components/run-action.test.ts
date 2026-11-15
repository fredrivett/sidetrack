import { redirect } from "next/navigation";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runAction } from "./run-action";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("posthog-js", () => ({ default: { captureException: vi.fn() } }));

afterEach(() => vi.clearAllMocks());

describe("runAction", () => {
  it("says what failed and resolves false, so callers can stop", async () => {
    const ok = await runAction(Promise.reject(new Error("Failed to fetch")), "rename “Home”");
    expect(ok).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("Couldn't rename “Home”. Please try again.");
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
  });
});
