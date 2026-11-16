"use client";

import { History } from "lucide-react";
import { unstable_rethrow, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { AssigneeView, PendingInviteView } from "@/core/members";
import { listDoneBeforeAction, setTimeZoneAction } from "@/app/actions";
import type { Category, Item, ItemPrLink, Project } from "@/core/schema";
import type { PendingSpaceInviteView, SpaceView } from "@/core/spaces";
import { isEditableTarget, matchesShortcut } from "@/lib/keyboard";
import { Button } from "@/components/ui/button";
import { AddProjectButton } from "./AddProjectButton";
import { ArchivedListsMenu } from "./ArchivedListsMenu";
import { AuditDialog } from "./AuditDialog";
import { BoardHeader, BoardMain, BoardRail } from "./BoardLayout";
import { CommandPalette } from "./CommandPalette";
import { DoneView } from "./DoneView";
import { InvitesBanner } from "./InvitesBanner";
import { ItemDetailDialog } from "./ItemDetailDialog";
import { NewItemDialog } from "./NewItemDialog";
import { NoDateView } from "./NoDateView";
import { NewProjectDialog } from "./NewProjectDialog";
import { ProjectColumn } from "./ProjectColumn";
import { PullToSearch } from "./PullToSearch";
import { ShareDialog } from "./ShareDialog";
import { saveCollapsedTrays, SpaceTray } from "./SpaceTray";
import { TodayView } from "./TodayView";
import { useDayStart } from "./use-day-start";
import { useItemDetailDialog } from "./use-item-detail-dialog";
import { RemoveListContext, useOptimisticLists } from "./use-list-saves";
import {
  applyItemChange,
  type ItemChange,
  ItemChangesContext,
  useOptimisticItems,
} from "./use-optimistic-items";
import type { AvatarUser } from "./UserAvatar";
import { UserMenu } from "./UserMenu";

/**
 * A list (a "project" in code) plus per-viewer display data: whether the viewer owns it (vs. it
 * being shared with them), and its display ref-prefix (qualified `alice/SID`
 * when the prefix clashes on this board, bare `SID` otherwise).
 */
export type ProjectView = Project & { isOwner: boolean; refPrefix: string };

/** The header's views; the board's is the default, and has no `?view=`. */
const BOARD_VIEWS = [
  ["board", "Board"],
  ["today", "Today"],
  ["no-date", "No date"],
  ["done", "Done"],
] as const;
export type BoardView = (typeof BOARD_VIEWS)[number][0];

/** How many more older finished items the Done view loads at a time. */
const DONE_PAGE = 50;

export function Kanban({
  viewerId,
  viewer,
  timeZone,
  initialView,
  projects: serverProjects,
  itemsByProject: serverItemsByProject,
  completedSince,
  categoriesByProject,
  assigneesByProject,
  prLinksByItem,
  pendingInvites,
  spaces,
  pendingSpaceInvites,
  initialCollapsedTrays,
  initialListId,
}: {
  viewerId: string;
  /** The viewer's own display fields, for the avatar on the Account button. */
  viewer: AvatarUser | null;
  /** The timezone saved for the viewer, kept in step with their browser. */
  timeZone: string | null;
  /** From `?view=`, so a reload or shared link opens on the same view. */
  initialView: BoardView;
  projects: ProjectView[];
  /**
   * Every list's open items and its items finished at or after this, with
   * their checklists. Older finished items load on demand (the Done view,
   * ⌘K), into the same items.
   */
  itemsByProject: Record<string, Item[]>;
  completedSince: number;
  categoriesByProject: Record<string, Category[]>;
  assigneesByProject: Record<string, AssigneeView[]>;
  prLinksByItem: Record<string, ItemPrLink[]>;
  pendingInvites: PendingInviteView[];
  /** The Spaces the viewer has joined, with their role in each. */
  spaces: SpaceView[];
  pendingSpaceInvites: PendingSpaceInviteView[];
  /** Trays ("personal" or Space ids) this browser has collapsed, from its cookie. */
  initialCollapsedTrays: string[];
  /** From `?p=`, the list the board opens centred on. */
  initialListId: string | null;
}) {
  const railRef = useRef<HTMLDivElement>(null);

  // Finished items older than the board's: the Done view's pages, the newest
  // `doneLimit` of them, and ⌘K's matches for `search`. Both read again
  // whenever the server's items do (after any change), so an edit, reopen or
  // delete shows in them too.
  const [doneLimit, setDoneLimit] = useState(0);
  const [older, setOlder] = useState<
    (Awaited<ReturnType<typeof listDoneBeforeAction>> & { limit: number }) | null
  >(null);
  // A failed read stops the paging (no retrying on its own) until Try again.
  const [doneFailed, setDoneFailed] = useState(false);
  const [doneTries, setDoneTries] = useState(0);
  const [, startRead] = useTransition();
  useEffect(() => {
    if (doneLimit === 0) return;
    let stale = false;
    startRead(async () => {
      // A signed-out read rejects with Next's redirect to /login; let that
      // through so it navigates.
      const page = await listDoneBeforeAction({
        before: completedSince,
        limit: doneLimit,
      }).catch((e) => {
        unstable_rethrow(e);
        return null;
      });
      if (stale) return;
      if (page) setOlder({ ...page, limit: doneLimit });
      setDoneFailed(!page);
    });
    return () => {
      stale = true;
    };
  }, [doneLimit, doneTries, completedSince, serverItemsByProject]);
  const loadingDone = !doneFailed && doneLimit !== (older?.limit ?? 0);
  const loadMoreDone = useCallback(() => {
    if (!loadingDone && !doneFailed) setDoneLimit((n) => n + DONE_PAGE);
  }, [loadingDone, doneFailed]);
  const retryDone = useCallback(() => {
    setDoneFailed(false);
    setDoneTries((n) => n + 1);
  }, []);

  const [search, setSearch] = useState("");
  const [found, setFound] = useState<{ query: string; items: Item[] } | null>(null);
  useEffect(() => {
    const query = search.trim();
    if (query.length < 2) return;
    let stale = false;
    startRead(async () => {
      // Search is a bonus over the board's own items: a failure leaves those.
      const page = await listDoneBeforeAction({
        before: completedSince,
        limit: 20,
        query,
      }).catch((e) => {
        unstable_rethrow(e);
        return null;
      });
      if (page && !stale) setFound({ query: search, items: page.items });
    });
    return () => {
      stale = true;
    };
  }, [search, completedSince, serverItemsByProject]);

  const allItemsByProject = useMemo(() => {
    const extra = [
      ...(older?.items ?? []),
      ...(found?.query === search ? found.items : []),
    ];
    if (extra.length === 0) return serverItemsByProject;
    // The server's copy wins: an older item reopened is back on the board.
    const seen = new Set(Object.values(serverItemsByProject).flat().map((i) => i.id));
    const merged: Record<string, Item[]> = {};
    for (const [projectId, list] of Object.entries(serverItemsByProject)) {
      merged[projectId] = [...list];
    }
    for (const item of extra) {
      if (seen.has(item.id) || !merged[item.projectId]) continue;
      seen.add(item.id);
      merged[item.projectId].push(item);
    }
    return merged;
  }, [serverItemsByProject, older, found, search]);

  // Every view reads items and lists from here, so a change shown ahead of the
  // server (a tick, a delete, a move) shows at once wherever it appears.
  // The Done view's older pages are a copy the refresh doesn't replace, so a
  // saved change is applied to them too; otherwise a deleted or moved older
  // item would show as it was until they're read again.
  const applyToOlder = useCallback((change: ItemChange) => {
    setOlder((o) => o && { ...o, items: applyItemChange(o.items, change) });
    setFound((f) => f && { ...f, items: applyItemChange(f.items, change) });
  }, []);
  const [itemsByProject, itemChanges] = useOptimisticItems(allItemsByProject, applyToOlder);
  const [projects, removeList] = useOptimisticLists(serverProjects);
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
  // New list starts in the Space of the tray whose + opened it, else in none.
  const [newList, setNewList] = useState({ open: false, spaceId: "" });
  const [share, setShare] = useState<{
    open: boolean;
    projectId: string | null;
    projectName: string;
  }>({ open: false, projectId: null, projectName: "" });

  // Active lists keep the viewer's order; paused lists follow, collapsed at the
  // end; archived lists leave the board for the Archived menu. Each group
  // keeps its own neighbours and ends for the Move items, so a move never crosses
  // into another group (where the position change wouldn't show).
  const active = projects.filter((p) => p.status === "active");
  const paused = projects.filter((p) => p.status === "paused");
  const archived = projects.filter((p) => p.status === "archived");
  const onBoard = [...active, ...paused];

  // For someone in a Space, the board groups lists on trays: "Personal" for
  // lists in none of their Spaces, then one per Space, empty ones included.
  // Collapsed trays are remembered per browser in a cookie, so the board
  // renders them collapsed from the first paint. The tray holding ?p='s list
  // starts open, so a link to a list shows it.
  const trays = [
    { id: "personal", name: "Personal", icon: null },
    ...spaces.map((s) => ({ id: s.id, name: s.name, icon: s.icon })),
  ];
  const trayOf = (p: ProjectView) =>
    spaces.find((s) => s.id === p.spaceId)?.id ?? "personal";
  const trayByList: Record<string, string> = Object.fromEntries(
    onBoard.map((p) => [p.id, trayOf(p)]),
  );
  const [collapsedTrays, setCollapsedTrays] = useState(() => {
    const collapsed = new Set(initialCollapsedTrays);
    if (initialListId) collapsed.delete(trayByList[initialListId]);
    return collapsed;
  });
  function setTrayCollapsed(trayId: string, value: boolean) {
    const next = new Set(collapsedTrays);
    if (value) next.add(trayId);
    else next.delete(trayId);
    setCollapsedTrays(next);
    saveCollapsedTrays([...next]);
    // ?p= follows the list on view; once its tray folds away it isn't, and
    // keeping it would open the tray again on the next load.
    const url = new URL(window.location.href);
    const shown = url.searchParams.get("p");
    if (value && shown && trayByList[shown] === trayId) {
      url.searchParams.delete("p");
      window.history.replaceState(null, "", url.toString());
    }
  }

  const [paletteOpen, setPaletteOpen] = useState(false);
  // Items opened from the palette get their own dialog here, since the item
  // may sit in a list the current view doesn't show.
  const boardItems = onBoard.flatMap((p) => itemsByProject[p.id] ?? []);
  const paletteDetail = useItemDetailDialog(boardItems);
  const paletteProject = onBoard.find(
    (p) => p.id === paletteDetail.item?.projectId,
  );

  // Centre a list in the rail, switching to the board first when needed; the
  // effect below scrolls to ?p= once the rail mounts. A collapsed tray opens
  // first, and the scroll waits for it to finish widening.
  function openList(projectId: string) {
    const url = new URL(window.location.href);
    url.searchParams.set("p", projectId);
    window.history.replaceState(null, "", url.toString());
    // Without Spaces there are no trays, whatever the cookie says.
    const trayId = spaces.length > 0 ? (trayByList[projectId] ?? "") : "";
    const opening = collapsedTrays.has(trayId);
    if (opening) setTrayCollapsed(trayId, false);
    if (view !== "board") {
      switchView("board");
      return;
    }
    setTimeout(
      () =>
        railRef.current
          ?.querySelector(`[data-project-id="${CSS.escape(projectId)}"]`)
          ?.scrollIntoView({ behavior: "smooth", inline: "center" }),
      opening ? 300 : 0,
    );
  }

  const openShare = useCallback(
    (projectId: string, projectName: string) =>
      setShare({ open: true, projectId, projectName }),
    [],
  );

  // Open the new-item dialog with the caller's list (a list's ⋯ menu), or
  // none (the C shortcut, the palette), which the dialog suggests from the
  // title. With no lists on the board, there's nowhere to add an item —
  // start a list instead.
  const openNewItem = useCallback(
    (projectId?: string) => {
      if (!projects.some((p) => p.status !== "archived")) {
        setNewList({ open: true, spaceId: "" });
        return;
      }
      setNewItem({ open: true, projectId: projectId ?? null });
    },
    [projects],
  );

  // The columns of a tray (or of the whole board without Spaces), given as its
  // active and paused lists; the ⋯ menu's moves stay within each group. They
  // render as one array, not one per group: keys only match within an array,
  // so pausing or resuming a list would otherwise remount its column, closing
  // its details dialog and dropping focus.
  const columns = (groups: ProjectView[][]) =>
    groups.flatMap((group) => group.map((p, idx) => (
      <ProjectColumn
        key={p.id}
        project={p}
        viewerId={viewerId}
        items={itemsByProject[p.id] ?? []}
        assignees={assigneesByProject[p.id] ?? []}
        prLinksByItem={prLinksByItem}
        prevId={group[idx - 1]?.id ?? null}
        nextId={group[idx + 1]?.id ?? null}
        firstId={group[0].id}
        lastId={group[group.length - 1].id}
        onShowActivity={(pid) => setAudit({ open: true, projectId: pid })}
        onAddItem={openNewItem}
        onShare={openShare}
        spaces={spaces}
      />
    )));

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
        setNewList({ open: true, spaceId: "" });
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
    <ItemChangesContext value={itemChanges}>
    <RemoveListContext value={removeList}>
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
                  className={`whitespace-nowrap rounded px-1.5 py-0.5 transition max-[360px]:px-1 sm:px-2 ${
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
        <InvitesBanner invites={pendingInvites} spaceInvites={pendingSpaceInvites} />
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
        ) : view === "done" ? (
          <DoneView
            projects={onBoard}
            itemsByProject={itemsByProject}
            assigneesByProject={assigneesByProject}
            prLinksByItem={prLinksByItem}
            viewerId={viewerId}
            since={older?.since ?? completedSince}
            more={older?.more ?? true}
            loading={loadingDone}
            failed={doneFailed}
            onLoadMore={loadMoreDone}
            onRetry={retryDone}
          />
        ) : (
          <BoardRail ref={railRef}>
            {spaces.length === 0 ? (
              <>
                {onBoard.length === 0 && (
                  <div className="m-auto text-sm text-neutral-500">
                    {archived.length > 0
                      ? "Every list is archived — restore one from Archived, or tap + Add list."
                      : "No lists yet — tap + Add list to start."}
                  </div>
                )}
                {columns([active, paused])}
                <AddProjectButton onClick={() => setNewList({ open: true, spaceId: "" })} />
              </>
            ) : (
              trays.map((tray) => {
                const inTray = (p: ProjectView) => trayOf(p) === tray.id;
                const lists = onBoard.filter(inTray);
                const spaceId = tray.id === "personal" ? "" : tray.id;
                return (
                  <SpaceTray
                    key={tray.id}
                    name={tray.name}
                    icon={tray.icon}
                    lists={lists}
                    collapsed={collapsedTrays.has(tray.id)}
                    onToggle={() => setTrayCollapsed(tray.id, !collapsedTrays.has(tray.id))}
                    onAddList={() => setNewList({ open: true, spaceId })}
                    onOpenList={openList}
                  >
                    {lists.length === 0 ? (
                      <AddProjectButton
                        shortcut={tray.id === "personal"}
                        onClick={() => setNewList({ open: true, spaceId })}
                      />
                    ) : (
                      // Moves stay within the tray (and within its active or
                      // paused lists), where the new order shows.
                      columns([active.filter(inTray), paused.filter(inTray)])
                    )}
                  </SpaceTray>
                );
              })
            )}
          </BoardRail>
        )}

        <AuditDialog
          open={audit.open}
          projectId={audit.projectId}
          projects={projects}
          items={boardItems}
          // Opening a comment's item swaps Activity for the item's dialog.
          onOpenItem={(item) => {
            setAudit({ open: false });
            paletteDetail.openDetail(item);
          }}
          onClose={() => setAudit({ open: false })}
        />

        <NewItemDialog
          open={newItem.open}
          onOpenChange={(open) => setNewItem((s) => ({ ...s, open }))}
          // From the toast: the item opens in place of New item, not over it.
          onOpenItem={(item) => {
            setNewItem((s) => ({ ...s, open: false }));
            paletteDetail.openDetail(item);
          }}
          projects={onBoard}
          categoriesByProject={categoriesByProject}
          assigneesByProject={assigneesByProject}
          viewerId={viewerId}
          initialProjectId={newItem.projectId}
        />

        <NewProjectDialog
          open={newList.open}
          onOpenChange={(open) => setNewList((s) => ({ ...s, open }))}
          takenPrefixes={projects.filter((p) => p.isOwner).map((p) => p.prefix)}
          spaces={spaces}
          defaultSpaceId={newList.spaceId}
        />

        <PullToSearch onOpen={() => setPaletteOpen(true)} />

        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          lists={onBoard}
          itemsByProject={itemsByProject}
          onNewItem={() => openNewItem()}
          onNewList={() => setNewList({ open: true, spaceId: "" })}
          onSwitchView={switchView}
          onShowActivity={() => setAudit({ open: true })}
          onOpenList={openList}
          onOpenItem={paletteDetail.openDetail}
          onSearch={setSearch}
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
            prefix={paletteProject.refPrefix}
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
    </RemoveListContext>
    </ItemChangesContext>
  );
}
