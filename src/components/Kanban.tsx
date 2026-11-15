"use client";

import { History } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AssigneeView, PendingInviteView } from "@/core/members";
import { setTimeZoneAction } from "@/app/actions";
import type { Category, Item, ItemPrLink, Project } from "@/core/schema";
import { isEditableTarget, matchesShortcut } from "@/lib/keyboard";
import { Button } from "@/components/ui/button";
import { AddProjectButton } from "./AddProjectButton";
import { ArchivedListsMenu } from "./ArchivedListsMenu";
import { AuditDialog } from "./AuditDialog";
import { BoardHeader, BoardMain, BoardRail } from "./BoardLayout";
import { CommandPalette } from "./CommandPalette";
import { InvitesBanner } from "./InvitesBanner";
import { ItemDetailDialog } from "./ItemDetailDialog";
import { NewItemDialog } from "./NewItemDialog";
import { NoDateView } from "./NoDateView";
import { NewProjectDialog } from "./NewProjectDialog";
import { ProjectColumn } from "./ProjectColumn";
import { PullToSearch } from "./PullToSearch";
import { ShareDialog } from "./ShareDialog";
import { TodayView } from "./TodayView";
import { useDayStart } from "./use-day-start";
import { useItemDetailDialog } from "./use-item-detail-dialog";
import {
  CompletionContext,
  useOptimisticCompletion,
} from "./use-optimistic-completion";
import type { AvatarUser } from "./UserAvatar";
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

/** The header's views; the board's is the default, and has no `?view=`. */
const BOARD_VIEWS = [
  ["board", "Board"],
  ["today", "Today"],
  ["no-date", "No date"],
] as const;
export type BoardView = (typeof BOARD_VIEWS)[number][0];

export function Kanban({
  viewerId,
  viewer,
  timeZone,
  initialView,
  projects,
  itemsByProject: serverItemsByProject,
  categoriesByProject,
  assigneesByProject,
  prLinksByItem,
  pendingInvites,
}: {
  viewerId: string;
  /** The viewer's own display fields, for the avatar on the Account button. */
  viewer: AvatarUser | null;
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
  // Every view reads items from here, so a tick shows at once wherever the
  // item appears (see the hook).
  const [itemsByProject, setCompleted] =
    useOptimisticCompletion(serverItemsByProject);
  const [view, setView] = useState<BoardView>(initialView);
  function switchView(next: BoardView) {
    setView(next);
    const url = new URL(window.location.href);
    if (next === "board") url.searchParams.delete("view");
    else url.searchParams.set("view", next);
    window.history.replaceState(null, "", url.toString());
  }

  const router = useRouter();
  // Agents work out "today" in the viewer's timezone (list_today), so save
  // the browser's whenever it differs, e.g. after travelling. A tab left open
  // across a flight rechecks when it comes back into view.
  useEffect(() => {
    function sync() {
      const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (browserZone && browserZone !== timeZone) {
        // Reload once it's saved: repeating items reopen by the viewer's day.
        void setTimeZoneAction(browserZone).then(() => router.refresh());
      }
    }
    sync();
    function onVisible() {
      if (document.visibilityState === "visible") sync();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [timeZone, router]);

  // When the day turns over with the page open (or a tab comes back the next
  // morning), reload the board: the server reopens repeating items due today.
  const dayStart = useDayStart();
  const shownDay = useRef(dayStart);
  useEffect(() => {
    if (!Number.isFinite(dayStart)) return;
    if (Number.isFinite(shownDay.current) && shownDay.current !== dayStart) {
      router.refresh();
    }
    shownDay.current = dayStart;
  }, [dayStart, router]);
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

  const [paletteOpen, setPaletteOpen] = useState(false);
  // Items opened from the palette get their own dialog here, since the item
  // may sit in a list the current view doesn't show.
  const boardItems = onBoard.flatMap((p) => itemsByProject[p.id] ?? []);
  const paletteDetail = useItemDetailDialog(boardItems);
  const paletteProject = onBoard.find(
    (p) => p.id === paletteDetail.item?.projectId,
  );

  // Centre a list in the rail, switching to the board first when needed; the
  // effect below scrolls to ?p= once the rail mounts.
  function openList(projectId: string) {
    const url = new URL(window.location.href);
    url.searchParams.set("p", projectId);
    window.history.replaceState(null, "", url.toString());
    if (view !== "board") {
      switchView("board");
      return;
    }
    railRef.current
      ?.querySelector(`[data-project-id="${CSS.escape(projectId)}"]`)
      ?.scrollIntoView({ behavior: "smooth", inline: "center" });
  }

  const openShare = useCallback(
    (projectId: string, projectName: string) =>
      setShare({ open: true, projectId, projectName }),
    [],
  );

  // Open the new-item dialog, seeding its list from the caller, falling back
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

  // Global shortcuts: ⌘K / Ctrl+K toggles the command palette, even from a
  // field. Then Linear-style bare keys: / → palette, C → new item, ⇧C → new
  // list. Those are skipped while typing in a field, and when a command
  // modifier is held so we don't shadow ⌘C / Ctrl+C copy.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (matchesShortcut(e, { key: "k", mod: true, shift: false, alt: false })) {
        e.preventDefault();
        // Holding the keys repeats keydown; toggle once per press.
        if (!e.repeat) setPaletteOpen((o) => !o);
        return;
      }
      if (isEditableTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (matchesShortcut(e, { key: "/" })) {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (matchesShortcut(e, { key: "c", shift: true })) {
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

  // On first paint, and on coming back from Today or No date (which unmount
  // the rail):
  // scroll to ?p=<id> if present.
  useEffect(() => {
    if (view !== "board") return;
    const params = new URLSearchParams(window.location.search);
    const targetId = params.get("p");
    if (!targetId) return;
    const el = railRef.current?.querySelector(
      `[data-project-id="${CSS.escape(targetId)}"]`,
    );
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ behavior: "instant", inline: "center" });
    }
  }, [view]);

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
    <CompletionContext value={setCompleted}>
      <BoardMain>
        <BoardHeader
          nav={
            <div
              role="group"
              aria-label="View"
              className="flex rounded-md border border-neutral-200 p-0.5 text-xs font-medium dark:border-neutral-800"
            >
              {BOARD_VIEWS.map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => switchView(v)}
                  className={`whitespace-nowrap rounded px-1.5 py-0.5 transition sm:px-2 ${
                    view === v
                      ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                      : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          }
        >
          {/* The count gives way on phones and small tablets, where the header is full. */}
          <span className="hidden whitespace-nowrap text-xs text-neutral-400 md:inline">
            {onBoard.length} list{onBoard.length === 1 ? "" : "s"}
          </span>
          <ArchivedListsMenu lists={archived} />
          {/* Icon and label on desktop, just the icon on phones. */}
          <Button
            variant="outline"
            size="sm"
            aria-label="Activity"
            onClick={() => setAudit({ open: true })}
          >
            <History />
            <span className="hidden sm:inline">Activity</span>
          </Button>
          <UserMenu user={viewer} />
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
        ) : view === "no-date" ? (
          <NoDateView
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

        <AuditDialog
          open={audit.open}
          projectId={audit.projectId}
          projects={projects}
          onClose={() => setAudit({ open: false })}
        />

        <NewItemDialog
          open={newItem.open}
          onOpenChange={(open) => setNewItem((s) => ({ ...s, open }))}
          projects={onBoard}
          categoriesByProject={categoriesByProject}
          initialProjectId={newItem.projectId}
        />

        <NewProjectDialog
          open={newProjectOpen}
          onOpenChange={setNewProjectOpen}
          takenPrefixes={projects.filter((p) => p.isOwner).map((p) => p.prefix)}
        />

        <PullToSearch onOpen={() => setPaletteOpen(true)} />

        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          lists={onBoard}
          itemsByProject={itemsByProject}
          onNewItem={() => openNewItem()}
          onNewList={() => setNewProjectOpen(true)}
          onSwitchView={switchView}
          onShowActivity={() => setAudit({ open: true })}
          onOpenList={openList}
          onOpenItem={paletteDetail.openDetail}
        />

        {paletteDetail.item && paletteProject && (
          <ItemDetailDialog
            item={paletteDetail.item}
            parent={boardItems.find((i) => i.id === paletteDetail.item?.parentId) ?? null}
            checklist={boardItems.filter((i) => i.parentId === paletteDetail.item?.id)}
            // The same rule as the board's dialog (ProjectColumn), within the
            // item's own list.
            nestTargets={boardItems.filter(
              (i) =>
                i.projectId === paletteDetail.item?.projectId &&
                i.parentId === null &&
                i.completedAt === null &&
                i.id !== paletteDetail.item?.id,
            )}
            onOpenItem={paletteDetail.openDetail}
            prefix={paletteProject.prefix}
            assignees={assigneesByProject[paletteProject.id] ?? []}
            viewerId={viewerId}
            prLinks={prLinksByItem[paletteDetail.item.id] ?? []}
            open={paletteDetail.open}
            onOpenChange={paletteDetail.onOpenChange}
          />
        )}

        <ShareDialog
          open={share.open}
          onOpenChange={(open) => setShare((s) => ({ ...s, open }))}
          projectId={share.projectId}
          projectName={share.projectName}
        />
      </BoardMain>
    </CompletionContext>
  );
}
