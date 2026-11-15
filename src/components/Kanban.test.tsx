// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
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
    categoriesByProject={{}}
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

describe("Kanban", () => {
  it.each([
    ["without Spaces", [], null],
    ["in a Space's tray", [space], space.id],
  ])("keeps a list's column, and focus in it, when the list is paused (%s)", (_, spaces, spaceId) => {
    const { rerender } = render(
      board([list("a", "Home", "active", spaceId), list("b", "Work", "active", spaceId)], spaces),
    );
    const [trigger] = screen.getAllByRole("button", { name: "List options" });
    trigger.focus();

    // Paused lists follow the active ones, so Home moves behind Work.
    rerender(
      board([list("a", "Home", "paused", spaceId), list("b", "Work", "active", spaceId)], spaces),
    );

    const columns = [...document.querySelectorAll("[data-project-id]")];
    expect(columns.map((c) => c.getAttribute("data-project-id"))).toEqual(["b", "a"]);
    expect(document.activeElement).toBe(trigger);
    expect(columns[1].contains(trigger)).toBe(true);
  });
});
