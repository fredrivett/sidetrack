// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/release", () => ({ RELEASE: "aaa" }));
const toast = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast }));

const reload = vi.fn();
let live: () => Promise<Response>;

beforeEach(() => {
  // A fresh module each time: once it learns it's out of date, it stays so.
  vi.resetModules();
  reload.mockClear();
  toast.mockClear();
  vi.stubGlobal("location", { ...location, reload });
  vi.stubGlobal("fetch", vi.fn(() => live()));
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

  // Registers a visibility listener that outlives the module, so it's last.
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
});
