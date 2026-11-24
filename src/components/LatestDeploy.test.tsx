// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/release", () => ({ RELEASE: "aaa" }));
const toast = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast }));

const reload = vi.fn();
let live: () => Promise<Response>;
// Better Auth's get-session: the session, or null signed out.
let session: unknown;

beforeEach(() => {
  // A fresh module each time: once it learns it's out of date, it stays so.
  vi.resetModules();
  reload.mockClear();
  toast.mockClear();
  session = { user: { id: "u1" } };
  vi.stubGlobal("location", { ...location, reload });
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      url === "/api/auth/get-session" ? Promise.resolve(Response.json(session)) : live(),
    ),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const server = (release: string) => async () => new Response(release);

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("refreshIfCurrent", () => {
  it("refreshes when the server is on the page's own deploy", async () => {
    const { refreshIfCurrent } = await import("./LatestDeploy");
    live = server("aaa");
    const router = { refresh: vi.fn() };
    await refreshIfCurrent(router);
    expect(router.refresh).toHaveBeenCalledOnce();
    expect(toast).not.toHaveBeenCalled();
  });

  // Next answers a refresh it can't serve, such as a 502 mid-deploy, with a
  // full page load, so a failed check mustn't refresh, nor end live updates.
  it.each([
    ["is down", async () => new Response("Bad gateway", { status: 502 })],
    ["can't be reached", () => Promise.reject(new TypeError("Failed to fetch"))],
  ])("skips the refresh while the server %s, and tries again next time", async (_, down) => {
    const { refreshIfCurrent } = await import("./LatestDeploy");
    const router = { refresh: vi.fn() };
    live = down;
    await refreshIfCurrent(router);
    expect(router.refresh).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    live = server("aaa");
    await refreshIfCurrent(router);
    expect(router.refresh).toHaveBeenCalledOnce();
  });

  // These register a visibility listener that outlives the module, so
  // they're last, and only the first checks the reload.
  it("on a newer deploy, says so instead, and reloads once hidden with nothing in progress", async () => {
    const { refreshIfCurrent } = await import("./LatestDeploy");
    live = server("bbb");
    const router = { refresh: vi.fn() };
    await Promise.all([refreshIfCurrent(router), refreshIfCurrent(router)]);
    expect(router.refresh).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledOnce();
    expect(toast.mock.calls[0][0]).toBe("Sidetrack has been updated");

    // Out of date for good: no more asking, nor refreshing.
    vi.mocked(fetch).mockClear();
    await refreshIfCurrent(router);
    expect(fetch).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();

    // Not while a dialog is open, nor while typing, and never in view.
    document.body.innerHTML = `<div role="dialog"></div>`;
    setVisibility("hidden");
    document.body.innerHTML = `<input />`;
    document.querySelector("input")?.focus();
    setVisibility("hidden");
    document.body.innerHTML = "";
    setVisibility("visible");
    expect(reload).not.toHaveBeenCalled();

    setVisibility("hidden");
    expect(reload).toHaveBeenCalledOnce();
  });

  // Signed out, there's nothing of theirs on the page to reload for, but it
  // still moves over once hidden.
  it("on a newer deploy, doesn't say so to someone signed out", async () => {
    const { refreshIfCurrent } = await import("./LatestDeploy");
    live = server("bbb");
    session = null;
    const listen = vi.spyOn(document, "addEventListener");
    const router = { refresh: vi.fn() };
    await refreshIfCurrent(router);
    expect(router.refresh).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    expect(listen).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    listen.mockRestore();
  });

  // Only a clear "signed out" hides it: a failed check mustn't hide it from
  // someone signed in.
  it("on a newer deploy, still says so when the session check fails", async () => {
    const { refreshIfCurrent } = await import("./LatestDeploy");
    live = server("bbb");
    vi.mocked(fetch).mockImplementation(async (url) =>
      url === "/api/auth/get-session" ? new Response("Bad gateway", { status: 502 }) : live(),
    );
    await refreshIfCurrent({ refresh: vi.fn() });
    expect(toast).toHaveBeenCalledOnce();
  });
});
