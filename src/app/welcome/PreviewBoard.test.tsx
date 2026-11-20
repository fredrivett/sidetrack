// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { PreviewBoard } from "./PreviewBoard";

// The landing page's preview is for signed-out visitors, so a save that
// reaches the server fails for them: a toast, or a bounce to /login. Every
// server action is a stub here that records its name, so a shared component
// that starts saving some other way than ItemSavesContext and ItemChanges
// fails this test with the action's name. The Brief's greeting is written
// in the page, so asking the server for one (a fetch) fails it too.
const { called } = vi.hoisted(() => ({ called: [] as string[] }));
vi.mock(
  "@/app/actions",
  () =>
    new Proxy(
      {},
      {
        has: (_, name) => typeof name === "string" && name !== "then",
        get: (_, name) =>
          typeof name === "string" && name !== "then"
            ? (...args: unknown[]) => {
                called.push(`${name}(${JSON.stringify(args)})`);
                return Promise.reject(new Error(`${name} called from the preview`));
              }
            : undefined,
      },
    ),
);

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const router = { refresh: vi.fn(), push: vi.fn(), replace: vi.fn() };
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => router,
}));

const fetched = vi.fn();
vi.stubGlobal("fetch", fetched);

beforeAll(() => {
  // A mouse, so rows open their menu on right-click.
  window.matchMedia = ((query: string) => ({
    matches: query === "(hover: hover)",
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  globalThis.ResizeObserver ??= class {
    observe() {
      return undefined;
    }
    unobserve() {
      return undefined;
    }
    disconnect() {
      return undefined;
    }
  };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Checked right after each change, so a leak fails naming its action. */
const noServerCalls = () => expect(called, "server actions the preview called").toEqual([]);

/** The row for an item, by its title. */
const row = (title: string) =>
  screen.getByText(title).closest(".group") as HTMLElement;

it("keeps every change in the page", async () => {
  // The browser's day matches the page's, as it does for most visitors.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.parse("2026-11-16T09:00:00Z"));
  render(<PreviewBoard today="2026-11-16" now={Date.parse("2026-11-16T09:00:00Z")} />);

  // It opens on the Brief, whose greeting names today's item and the
  // overdue boiler service.
  const greeting = () => screen.getByRole("heading", { level: 2, name: /Fred\./ }).nextElementSibling as HTMLElement;
  expect(greeting().textContent).toMatch(
    /^Write the launch post is the one for today\. Book the boiler service slipped/,
  );

  // Fold Overdue away: it stays folded once its save settles.
  const overdue = () => screen.getByRole("button", { name: /^Overdue/ });
  fireEvent.click(overdue());
  await act(async () => {});
  noServerCalls();
  expect(overdue().getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(overdue());
  await act(async () => {});

  // Tick the boiler service off: the greeting stops naming it.
  const section = overdue().closest("section") as HTMLElement;
  fireEvent.click(within(section).getByRole("checkbox"));
  noServerCalls();
  expect(greeting().textContent).not.toMatch(/boiler/);
  expect(greeting().textContent).toMatch(
    /^Write the launch post is the one for today\. Take the bins out is due tomorrow\./,
  );

  fireEvent.click(screen.getByRole("button", { name: "Board" }));

  // Nest an item from its menu.
  fireEvent.contextMenu(row("Take the bins out"));
  fireEvent.click(screen.getByText("Sub-item of “Water the plants”"));
  noServerCalls();
  expect(within(row("Water the plants")).getByLabelText(/checklist, 0 of 1 done/)).toBeTruthy();

  // Give it a due date from its menu.
  fireEvent.contextMenu(row("Fix the dripping tap"));
  fireEvent.click(screen.getByText("Due date"));
  fireEvent.click(screen.getByRole("menuitem", { name: /^Tomorrow/ }));
  noServerCalls();
  // Due dates hold until saved, so it lands after the save's transition.
  expect(await within(row("Fix the dripping tap")).findByText("Tomorrow")).toBeTruthy();

  // Assign an agent, which starts it.
  fireEvent.click(within(row("Deep clean the oven")).getByLabelText(/Change assignees/));
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /Claude/ }));
  noServerCalls();
  expect(
    await within(row("Deep clean the oven")).findByLabelText(/^Claude \(agent, working\)/),
  ).toBeTruthy();

  // Collapse a checklist.
  fireEvent.click(screen.getByLabelText("Hide checklist, 0 of 3 done"));
  noServerCalls();
  expect(screen.queryByText("Email the roofers")).toBeNull();

  // Tick an item with an agent on it, which ends the agent's work.
  fireEvent.click(within(row("Fix signup email going to spam")).getByRole("checkbox"));
  noServerCalls();
  const spam = row("Fix signup email going to spam");
  expect(within(spam).getByRole("checkbox").getAttribute("aria-checked")).toBe("true");
  expect(within(spam).getByLabelText(/Change assignees/).getAttribute("aria-label")).not.toMatch(
    /working/,
  );

  expect(fetched).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
  expect(router.push).not.toHaveBeenCalled();
  expect(router.replace).not.toHaveBeenCalled();
  // One long walk through the whole page: over 4s alone, so the default 5s
  // isn't enough when the full suite shares the machine.
}, 15_000);
