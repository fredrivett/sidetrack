// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SpaceView } from "@/core/spaces";
import { NO_FILTERS } from "@/lib/filters";
import { Kanban, type ProjectView } from "./Kanban";

// The server actions pull in server-only modules (next/cache, the DB).
vi.mock("@/app/actions", () => ({
  listDoneBeforeAction: vi.fn(),
  setTimeZoneAction: vi.fn(() => Promise.resolve()),
  // The Agenda's greeting; it never arrives here.
  agendaGreetingAction: vi.fn(() => new Promise(() => {})),
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
    overdueCollapsed={false}
    projects={projects}
    itemsByProject={{ a: [], b: [] }}
    completedSince={0}
    labelsByProject={{}}
    assigneesByProject={{}}
    prLinksByItem={{}}
    pendingInvites={[]}
    spaces={spaces}
    trayOrder={["personal", ...spaces.map((s) => s.id)]}
    pendingSpaceInvites={[]}
    initialCollapsedTrays={[]}
    initialListId={null}
    initialItemId={null}
    notifications={[]}
    followedItemIds={[]}
    notificationLevels={{}}
    initialItemExtra={[]}
    filters={NO_FILTERS}
    aiEnabled={false}
  />
);

const space = { id: "s1", name: "Team", icon: null } as SpaceView;

describe.each([
  ["without Spaces", [] as SpaceView[], null],
  ["in a Space's tray", [space], space.id],
])("Kanban, an archived list %s", (_, spaces, spaceId) => {
  const columns = () =>
    [...document.querySelectorAll("[data-project-id]")].map((c) =>
      c.getAttribute("data-project-id"),
    );

  it("shows only in the Archived view", () => {
    render(
      board(
        [list("a", "Home", "archived", spaceId), list("b", "Work", "active", spaceId)],
        spaces,
      ),
    );
    expect(columns()).toEqual(["b"]);

    const account = screen.getByRole("button", { name: "Account" });
    fireEvent.pointerDown(account);
    fireEvent.click(account);
    fireEvent.click(screen.getByRole("menuitem", { name: "Archived lists (1)" }));
    expect(screen.getByRole("heading", { name: "Archived lists" })).toBeTruthy();
    expect(columns()).toEqual(["a"]);

    fireEvent.click(screen.getByRole("button", { name: "Back to board" }));
    expect(columns()).toEqual(["b"]);
  });
});

describe("Kanban, switching views", () => {
  it("puts each view at its own path, Agenda on 1 and Board on 2, keeping the query", () => {
    window.history.replaceState(null, "", "/board?x=1");
    render(board([list("b", "Work", "active", null)], []));
    fireEvent.keyDown(document, { key: "1" });
    expect(window.location.pathname + window.location.search).toBe("/agenda?x=1");
    fireEvent.keyDown(document, { key: "3" });
    expect(window.location.pathname).toBe("/done");
    fireEvent.keyDown(document, { key: "2" });
    expect(window.location.pathname).toBe("/board");
  });
});
