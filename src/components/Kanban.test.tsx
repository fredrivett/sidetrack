// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SpaceView } from "@/core/spaces";
import { Kanban, type ProjectView } from "./Kanban";

// The server actions pull in server-only modules (next/cache, the DB).
vi.mock("@/app/actions", () => ({
  listDoneBeforeAction: vi.fn(),
  setTimeZoneAction: vi.fn(() => Promise.resolve()),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  unstable_rethrow: vi.fn(),
}));

beforeAll(() => {
  window.IntersectionObserver = class {
    observe = vi.fn();
    disconnect = vi.fn();
  } as unknown as typeof IntersectionObserver;
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

const list = (
  id: string,
  name: string,
  status: ProjectView["status"],
  spaceId: string | null,
) =>
  ({
    id,
    name,
    status,
    prefix: name.slice(0, 3).toUpperCase(),
    refPrefix: name.slice(0, 3).toUpperCase(),
    summary: "",
    isOwner: true,
    spaceId,
  }) as unknown as ProjectView;

const board = (projects: ProjectView[], spaces: SpaceView[]) => (
  <Kanban
    viewerId="u1"
    viewer={null}
    timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}
    initialView="board"
    projects={projects}
    itemsByProject={{ a: [], b: [] }}
    completedSince={0}
    labelsByProject={{}}
    assigneesByProject={{}}
    prLinksByItem={{}}
    pendingInvites={[]}
    spaces={spaces}
    pendingSpaceInvites={[]}
    initialCollapsedTrays={[]}
    initialListId={null}
  />
);

const space = { id: "s1", name: "Team", icon: null } as SpaceView;

describe.each([
  ["without Spaces", [] as SpaceView[], null],
  ["in a Space's tray", [space], space.id],
])("Kanban, pausing a list %s", (_, spaces, spaceId) => {
  const before = board(
    [list("a", "Home", "active", spaceId), list("b", "Work", "active", spaceId)],
    spaces,
  );
  // Paused lists follow the active ones, so Home moves behind Work.
  const after = board(
    [list("a", "Home", "paused", spaceId), list("b", "Work", "active", spaceId)],
    spaces,
  );

  it("keeps its column, and focus in it", () => {
    const { rerender } = render(before);
    const [trigger] = screen.getAllByRole("button", { name: "List options" });
    trigger.focus();

    rerender(after);

    const columns = [...document.querySelectorAll("[data-project-id]")];
    expect(columns.map((c) => c.getAttribute("data-project-id"))).toEqual(["b", "a"]);
    expect(document.activeElement).toBe(trigger);
    expect(columns[1].contains(trigger)).toBe(true);
  });

  it("keeps its details dialog open", () => {
    const { rerender } = render(before);
    const [trigger] = screen.getAllByRole("button", { name: "List options" });
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "List details" }));
    expect(screen.getByRole("dialog").textContent).toContain("Home");

    rerender(after);

    expect(screen.getByRole("dialog").textContent).toContain("Home");
  });
});
