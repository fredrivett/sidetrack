"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AssigneeView, PendingInviteView } from "@/core/members";
import { setTimeZoneAction } from "@/app/actions";
import type { Category, Item, ItemPrLink, Project } from "@/core/schema";
import { isEditableTarget, matchesShortcut } from "@/lib/keyboard";
import { AddProjectButton } from "./AddProjectButton";
import { ArchivedListsMenu } from "./ArchivedListsMenu";
import { AuditDrawer } from "./AuditDrawer";
import { BoardHeader, BoardMain, BoardRail } from "./BoardLayout";
import { InvitesBanner } from "./InvitesBanner";
import { NewItemSheet } from "./NewItemSheet";
import { NewProjectSheet } from "./NewProjectSheet";
import { ProjectColumn } from "./ProjectColumn";
import { ShareSheet } from "./ShareSheet";
import { TodayView } from "./TodayView";
import { UserMenu } from "./UserMenu";

/**
 * A list (a "project" in code) plus per-viewer display data: whether the viewer owns it (vs. it
 * being shared with them), and its display ref-prefix (qualified `alice/SID`
 * when the prefix clashes on this board, bare `SID` otherwise).
 */
export type ProjectView = Project & { isOwner: boolean; refPrefix: string };

/** The list currently centred in the rail, tracked in `?p=<id>`. */
function centredProjectId(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("p");
}

export type BoardView = "board" | "today";

export function Kanban({
  viewerId,
  timeZone,
  initialView,
  projects,
  itemsByProject,
  categoriesByProject,
  assigneesByProject,
  prLinksByItem,
  pendingInvites,
}: {
  viewerId: string;
  /** The timezone saved for the viewer, kept in step with their browser. */
  timeZone: string | null;
  /** From `?view=`, so a reload or shared link opens on the same view. */
  initialView: BoardView;
  projects: ProjectView[];
  itemsByProject: Record<string, Item[]>;
  categoriesByProject: Record<string, Category[]>;
  assigneesByProject: Record<string, AssigneeView[]>;
  prLinksByItem: Record<string, ItemPrLink[]>;
  pendingInvites: PendingInviteView[];
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<BoardView>(initialView);
  function switchView(next: BoardView) {
    setView(next);
    const url = new URL(window.location.href);
    if (next === "today") url.searchParams.set("view", "today");
    else url.searchParams.delete("view");
    window.history.replaceState(null, "", url.toString());
  }

  // Agents work out "today" in the viewer's timezone (list_today), so save
  // the browser's whenever it differs, e.g. after travelling.
  useEffect(() => {
    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (browserZone && browserZone !== timeZone) {
      void setTimeZoneAction(browserZone);
    }
  }, [timeZone]);
  const initialised = useRef(false);
  const [audit, setAudit] = useState<{ open: boolean; projectId?: string }>({
    open: false,
  });
  const [newItem, setNewItem] = useState<{
    open: boolean;
    projectId: string | null;
  }>({ open: false, projectId: null });
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [share, setShare] = useState<{
    open: boolean;
    projectId: string | null;
    projectName: string;
  }>({ open: false, projectId: null, projectName: "" });

  // Active lists keep the viewer's order; paused lists follow, collapsed at the
  // end; archived lists leave the board for the Archived menu. Each group
  // keeps its own neighbours for Move left/right, so a move never crosses
  // into another group (where the position change wouldn't show).
  const active = projects.filter((p) => p.status === "active");
  const paused = projects.filter((p) => p.status === "paused");
  const archived = projects.filter((p) => p.status === "archived");
  const onBoard = [...active, ...paused];

  const openShare = useCallback(
    (projectId: string, projectName: string) =>
      setShare({ open: true, projectId, projectName }),
    [],
  );

  // Open the new-item sheet, seeding its list from the caller, falling back
  // to the centred column then the first list on the board. With no lists on
  // the board, there's nowhere to add an item — start a list instead.
  const openNewItem = useCallback(
    (projectId?: string) => {
      const isOnBoard = (id: string | null) =>
        projects.some((p) => p.id === id && p.status !== "archived");
      const first =
        projects.find((p) => p.status === "active") ??
        projects.find((p) => p.status === "paused");
      if (!first) {
        setNewProjectOpen(true);
        return;
      }
      // ?p= can still name a list that was just archived; skip it then.
      const centred = centredProjectId();
      const pid = projectId ?? (isOnBoard(centred) ? centred : null) ?? first.id;
      setNewItem({ open: true, projectId: pid });
    },
    [projects],
  );

  // Global shortcuts (Linear-style bare keys): C → new item, ⇧C → new list.
  // Skipped while typing in a field, and when a command modifier is held so we
  // don't shadow ⌘C / Ctrl+C copy.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isEditableTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (matchesShortcut(e, { key: "c", shift: true })) {
        e.preventDefault();
        setNewProjectOpen(true);
      } else if (matchesShortcut(e, { key: "c", shift: false })) {
        e.preventDefault();
        openNewItem();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [openNewItem]);

  // On first paint: scroll to ?p=<id> if present.
  useEffect(() => {
    if (initialised.current) return;
    initialised.current = true;
    const params = new URLSearchParams(window.location.search);
    const targetId = params.get("p");
    if (!targetId) return;
    const el = railRef.current?.querySelector(
      `[data-project-id="${CSS.escape(targetId)}"]`,
    );
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ behavior: "instant", inline: "center" });
    }
  }, []);

  // Observe which column is most centred; reflect in ?p=<id> via replaceState.
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;

    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        const id = (visible.target as HTMLElement).dataset.projectId;
        if (!id) return;
        const url = new URL(window.location.href);
        if (url.searchParams.get("p") === id) return;
        url.searchParams.set("p", id);
        window.history.replaceState(null, "", url.toString());
      },
      {
        root: rail,
        threshold: [0.55, 0.75, 0.95],
      },
    );

    rail.querySelectorAll("[data-project-id]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [projects, view]);

  return (
    <BoardMain>
      <BoardHeader
        nav={
          <div
            role="group"
            aria-label="View"
            className="flex rounded-md border border-neutral-200 p-0.5 text-xs font-medium dark:border-neutral-800"
          >
            {(["board", "today"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => switchView(v)}
                className={`rounded px-2 py-0.5 transition ${
                  view === v
                    ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                    : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                }`}
              >
                {v === "board" ? "Board" : "Today"}
              </button>
            ))}
          </div>
        }
      >
        {/* The count gives way on phones, where the header is full. */}
        <span className="hidden whitespace-nowrap text-xs text-neutral-400 sm:inline">
          {onBoard.length} list{onBoard.length === 1 ? "" : "s"}
        </span>
        <ArchivedListsMenu lists={archived} />
        <button
          type="button"
          onClick={() => setAudit({ open: true })}
          className="rounded-md border border-neutral-200 px-2 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-100 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          Activity
        </button>
        <UserMenu />
      </BoardHeader>
      <InvitesBanner invites={pendingInvites} />
      {view === "today" ? (
        <TodayView
          projects={active}
          itemsByProject={itemsByProject}
          assigneesByProject={assigneesByProject}
          prLinksByItem={prLinksByItem}
          viewerId={viewerId}
        />
      ) : (
        <BoardRail ref={railRef}>
          {onBoard.length === 0 && (
            <div className="m-auto text-sm text-neutral-500">
              {archived.length > 0
                ? "Every list is archived — restore one from Archived, or tap + Add list."
                : "No lists yet — tap + Add list to start."}
            </div>
          )}
          {[active, paused].map((group) =>
            group.map((p, idx) => (
              <ProjectColumn
                key={p.id}
                project={p}
                viewerId={viewerId}
                items={itemsByProject[p.id] ?? []}
                assignees={assigneesByProject[p.id] ?? []}
                prLinksByItem={prLinksByItem}
                prevId={group[idx - 1]?.id ?? null}
                nextId={group[idx + 1]?.id ?? null}
                onShowActivity={(pid) => setAudit({ open: true, projectId: pid })}
                onAddItem={openNewItem}
                onShare={openShare}
              />
            )),
          )}
          <AddProjectButton onClick={() => setNewProjectOpen(true)} />
        </BoardRail>
      )}

      <AuditDrawer
        open={audit.open}
        projectId={audit.projectId}
        projects={projects}
        onClose={() => setAudit({ open: false })}
      />

      <NewItemSheet
        open={newItem.open}
        onOpenChange={(open) => setNewItem((s) => ({ ...s, open }))}
        projects={onBoard}
        categoriesByProject={categoriesByProject}
        initialProjectId={newItem.projectId}
      />

      <NewProjectSheet open={newProjectOpen} onOpenChange={setNewProjectOpen} />

      <ShareSheet
        open={share.open}
        onOpenChange={(open) => setShare((s) => ({ ...s, open }))}
        projectId={share.projectId}
        projectName={share.projectName}
      />
    </BoardMain>
  );
}
