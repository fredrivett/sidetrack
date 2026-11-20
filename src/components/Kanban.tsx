"use client";

import { toast } from "sonner";
import { unstable_rethrow, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import type { AssigneeView, PendingInviteView } from "@/core/members";
import {
  getItemWithSubItemsAction,
  listDoneBeforeAction,
  reorderSpaceAction,
  setBoardFiltersAction,
  setTimeZoneAction,
} from "@/app/actions";
import type { Item, ItemPrLink, Label, ListAccess, NotificationLevel, Project } from "@/core/schema";
import type { NotificationView } from "@/core/notifications";
import type { PendingSpaceInviteView, SpaceView } from "@/core/spaces";
import { type ItemFilters, matchesFilters } from "@/lib/filters";
import { isEditableTarget, matchesShortcut } from "@/lib/keyboard";
import { LOCALE_COOKIE } from "@/lib/time";
import { CircleCheck, MessageSquarePlus, SquareKanban, Sunrise } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AddProjectButton } from "./AddProjectButton";
import { AuditDialog } from "./AuditDialog";
import { BoardHeader, BoardMain, BoardRail } from "./BoardLayout";
import { CommandPalette } from "./CommandPalette";
import { AgendaView } from "./AgendaView";
import { DoneView } from "./DoneView";
import { FilterMenu } from "./FilterMenu";
import { InvitesBanner } from "./InvitesBanner";
import { refreshIfCurrent } from "./LatestDeploy";
import { ItemDetailDialog } from "./ItemDetailDialog";
import { BoardDrag } from "./BoardDrag";
import { NewItemDialog } from "./NewItemDialog";
import { NotificationsInbox } from "./NotificationsInbox";
import { FollowsProvider } from "./follows";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { NotificationLevelsProvider, saveLevel } from "./notification-levels";
import { type FeedbackAbout, FeedbackDialog } from "./FeedbackDialog";
import { NewProjectDialog } from "./NewProjectDialog";
import { ProjectColumn } from "./ProjectColumn";
import { PullToSearch } from "./PullToSearch";
import { runAction } from "./run-action";
import { ShareDialog } from "./ShareDialog";
import { SpaceMenu } from "./SpaceMenu";
import { saveCollapsedTrays, SpaceTray } from "./SpaceTray";
import { useDayStart, useToday } from "./use-day-start";
import { useStoredState } from "./use-stored-state";
import { useItemDetailDialog } from "./use-item-detail-dialog";
import { useSameContent } from "./use-same-content";
import { LabelsContext } from "./Labels";
import { ListAccessContext } from "./list-access";
import { RemoveListContext, useOptimisticLists } from "./use-list-saves";
import {
  applyItemChange,
  type ItemChange,
  ItemChangesContext,
  useOptimisticItems,
} from "./use-optimistic-items";
import { assigneeName, type AvatarUser } from "./UserAvatar";
import { UserMenu } from "./UserMenu";
import { createSelection, NAV_KEYS, SelectedItemContext, stepItemRow } from "./useItemShortcuts";

/**
 * A list (a "project" in code) plus per-viewer display data: whether the viewer owns it (vs. it
 * being shared with them), and its display ref-prefix (qualified `alice/SID`
 * when the prefix clashes on this board, bare `SID` otherwise).
 */
export type ProjectView = Project & {
  isOwner: boolean;
  /** What the viewer can do on it: edit, comment or only view. */
  access: ListAccess;
  refPrefix: string;
  /** Offered to the admin while the list has no repository: see suggestedRepositories. */
  suggestedRepository?: string;
};

/** The header's views, each at its own path (/brief, /board, /done); / opens the Brief. */
const BOARD_VIEWS = [
  ["brief", "Brief", Sunrise],
  ["board", "Board", SquareKanban],
  ["done", "Done", CircleCheck],
] as const;
/** The switch's views, plus Archived, which the account menu opens. */
export type BoardView = (typeof BOARD_VIEWS)[number][0] | "archived";

/** How many more older finished items the Done view loads at a time. */
const DONE_PAGE = 50;

const NEW_ITEM_CLOSED: { open: boolean; projectId: string | null; dueToday?: boolean } = {
  open: false,
  projectId: null,
};

export function Kanban({
  viewerId,
  viewer,
  timeZone,
  initialView,
  overdueCollapsed,
  noDateCollapsed,
  noDateFoldedLists,
  projects: serverProjects,
  itemsByProject: serverItemsByProject,
  completedSince,
  labelsByProject,
  assigneesByProject,
  prLinksByItem,
  pendingInvites,
  spaces,
  trayOrder,
  pendingSpaceInvites,
  initialCollapsedTrays,
  initialListId,
  initialItemId,
  initialItemExtra,
  notifications,
  followedItemIds,
  notificationLevels,
  filters: savedFilters,
  aiEnabled,
  feedbackEnabled = false,
}: {
  viewerId: string;
  /** The viewer's own display fields, for the avatar on the Account button. */
  viewer: AvatarUser | null;
  /** The timezone saved for the viewer, kept in step with their browser. */
  timeZone: string | null;
  /** From the path (/brief, /board, …), so a reload or shared link opens on the same view. */
  initialView: BoardView;
  /** Whether the viewer keeps the Agenda's Overdue section folded away. */
  overdueCollapsed: boolean;
  /** Whether the viewer keeps the Agenda's No date section folded away. */
  noDateCollapsed: boolean;
  /** The lists whose cards the viewer keeps folded in the Agenda's No date. */
  noDateFoldedLists: string[];
  projects: ProjectView[];
  /**
   * Every list's open items and its items finished at or after this, with
   * their checklists. Older finished items load on demand (the Done view,
   * ⌘K), into the same items.
   */
  itemsByProject: Record<string, Item[]>;
  completedSince: number;
  /** Each list's labels, for every item's labels' emoji. */
  labelsByProject: Record<string, Label[]>;
  assigneesByProject: Record<string, AssigneeView[]>;
  prLinksByItem: Record<string, ItemPrLink[]>;
  pendingInvites: PendingInviteView[];
  /** The Spaces the viewer has joined, with their role in each. */
  spaces: SpaceView[];
  /** The trays' ids in the viewer's order: "personal" and their Spaces. */
  trayOrder: string[];
  pendingSpaceInvites: PendingSpaceInviteView[];
  /** Trays ("personal" or Space ids) this browser has collapsed, from its cookie. */
  initialCollapsedTrays: string[];
  /** From `?p=`, the list the board opens centred on. */
  initialListId: string | null;
  /** From `?item=`, an item to open on load, as tapping a notification does. */
  initialItemId: string | null;
  /** ?item= when it isn't on the board (done before this week), with its sub-items. */
  initialItemExtra: Item[];
  notifications: NotificationView[];
  /** The items the viewer follows, sub-items of followed parents included. */
  followedItemIds: string[];
  /** The notification levels the viewer has set, by scope. */
  notificationLevels: Record<string, NotificationLevel>;
  /** The viewer's own filters, as they last set them. */
  filters: ItemFilters;
  /** Whether Jev (TYPESAFE_API_KEY) is set up, for AI-only actions. */
  aiEnabled: boolean;
  /** Whether this deployment takes feedback (FEEDBACK_LIST_ID). */
  feedbackEnabled?: boolean;
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
  // The page shows the filters as soon as they're picked; saving them is so
  // the next visit, on any device, opens the same way. A save that fails
  // says so, and leaves them as picked on this page.
  const [filters, setFilters] = useState(savedFilters);
  function changeFilters(next: ItemFilters) {
    setFilters(next);
    void runAction(setBoardFiltersAction(next), "save your filters");
  }
  const switchView = useCallback((next: BoardView) => {
    setView(next);
    const url = new URL(window.location.href);
    url.pathname = `/${next}`;
    window.history.replaceState(null, "", url.toString());
  }, []);

  const router = useRouter();
  // Agents work out "today" in the viewer's timezone (list_today), so save
  // the browser's whenever it differs, e.g. after travelling. A tab left open
  // across a flight rechecks when it comes back into view.
  useEffect(() => {
    function sync() {
      // The server writes due labels in this locale on the next load.
      const locale = Intl.DateTimeFormat().resolvedOptions().locale;
      document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(locale)}; path=/; max-age=31536000; samesite=lax`;
      const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (browserZone && browserZone !== timeZone) {
        // Saving it reloads the board through LiveUpdates, so repeating
        // items reopen by the viewer's day. Not router.refresh() here: on
        // first load that raced the item dialog opening, and Next answered
        // with a full page load.
        void setTimeZoneAction(browserZone);
      }
    }
    sync();
    function onVisible() {
      if (document.visibilityState === "visible") sync();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [timeZone]);

  // When the day turns over with the page open (or a tab comes back the next
  // morning), reload the board: the server reopens repeating items due today.
  const dayStart = useDayStart();
  const shownDay = useRef(dayStart);
  useEffect(() => {
    if (!Number.isFinite(dayStart)) return;
    if (Number.isFinite(shownDay.current) && shownDay.current !== dayStart) {
      void refreshIfCurrent(router);
    }
    shownDay.current = dayStart;
  }, [dayStart, router]);
  const [audit, setAudit] = useState<{ open: boolean; projectId?: string }>({
    open: false,
  });
  // Kept for this tab, so New item and its draft come back after a reload.
  const [newItem, setNewItem] = useStoredState("new-item", NEW_ITEM_CLOSED, "session");
  // New list starts in the Space of the tray whose + opened it, else in none.
  const [newList, setNewList] = useState({ open: false, spaceId: "" });
  const [share, setShare] = useState<{
    open: boolean;
    projectId: string | null;
    projectName: string;
  }>({ open: false, projectId: null, projectName: "" });

  // Active lists are on the board, in the viewer's order. Archived lists, and
  // their items, show only in the Archived view, in the same order. Each
  // keeps its own neighbours and ends for the Move items, so a move never
  // crosses into the other (where the position change wouldn't show).
  const active = projects.filter((p) => p.status === "active");
  const archived = projects.filter((p) => p.status === "archived");
  // The lists the views' dialogs (an item's, New item) can reach: archived
  // ones too only from the Archived view.
  const shown = view === "archived" ? projects : active;

  // For someone in a Space, the board groups lists on trays, in their own
  // order: "Personal" for lists in none of their Spaces, and one per Space,
  // empty ones included.
  // Collapsed trays are remembered per browser in a cookie, so the board
  // renders them collapsed from the first paint. The tray holding ?p='s list
  // starts open, so a link to a list shows it.
  const trays = trayOrder.flatMap((id) =>
    id === "personal"
      ? [{ id, name: "Personal", icon: null, color: null, admin: false }]
      : spaces
          .filter((s) => s.id === id)
          .map((s) => ({
            id,
            name: s.name,
            icon: s.icon,
            color: s.color,
            admin: s.role === "admin",
          })),
  );
  const trayOf = (p: ProjectView) =>
    spaces.find((s) => s.id === p.spaceId)?.id ?? "personal";
  const trayByList: Record<string, string> = Object.fromEntries(
    active.map((p) => [p.id, trayOf(p)]),
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
  // Where an item can move: the board's lists, on their trays (one group
  // without Spaces), in the viewer's order, leaving out lists they can only
  // view or comment on. Nowhere with a single list.
  const movable = active.filter((p) => p.access === "edit");
  const moveGroups =
    spaces.length === 0
      ? [{ id: "personal", name: "Lists", lists: movable }]
      : trays
          .map((t) => ({ ...t, lists: movable.filter((p) => trayByList[p.id] === t.id) }))
          .filter((t) => t.lists.length > 0);
  const moveTargets = movable.length > 1 ? moveGroups : null;
  // Everyone on the board's lists, to filter by. Someone filtered by who has
  // since left every list no longer narrows anything.
  const people = [
    ...new Map(
      active.flatMap((p) => assigneesByProject[p.id] ?? []).map((a) => [a.userId, a]),
    ).values(),
  ].sort((a, b) => assigneeName(a).localeCompare(assigneeName(b)));
  // Every label on the board's lists; the same name in two lists is one
  // choice. A label since removed everywhere no longer narrows either.
  const labelChoices = [
    ...new Map(
      active
        .flatMap((p) => labelsByProject[p.id] ?? [])
        .reverse()
        .map((l) => [l.name, { name: l.name, emoji: l.emoji }]),
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name));
  const shownFilters = {
    ...filters,
    assignees: filters.assignees.filter((id) => people.some((p) => p.userId === id)),
    labels: filters.labels.filter((name) => labelChoices.some((l) => l.name === name)),
  };

  // Moving a tray holds it, dimmed, until the board comes back in the new
  // order, as moving a list holds its column.
  const [movingTrays, markTrayMoving] = useOptimistic(
    [] as string[],
    (cur, trayId: string) => [...cur, trayId],
  );
  const [, startTrayMove] = useTransition();
  function moveTray(tray: { id: string; name: string }, ref: string) {
    startTrayMove(async () => {
      markTrayMoving(tray.id);
      await runAction(reorderSpaceAction(tray.id, ref), `move “${tray.name}”`);
    });
  }
  // Setting a Space's notifications holds its tray the same way.
  function setTrayNotifications(tray: { id: string; name: string }, level: NotificationLevel | null) {
    startTrayMove(async () => {
      markTrayMoving(tray.id);
      await saveLevel(`space:${tray.id}`, level, tray.name);
    });
  }

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  // What the open form is a thumbs up or down on, or null for the header's.
  const [feedbackAbout, setFeedbackAbout] = useState<FeedbackAbout | null>(null);
  // The item the movement keys selected (stepItemRow), which owns the item
  // shortcuts until the pointer moves.
  // The rows read these, so a refresh that sends the same ones keeps them.
  const sameLabels = useSameContent(labelsByProject);
  // Kept out of state, so moving it doesn't re-render the board.
  const [selection] = useState(createSelection);
  // Items opened from the palette get their own dialog here, since the item
  // may sit in a list the current view doesn't show.
  const boardItems = shown.flatMap((p) => itemsByProject[p.id] ?? []);

  // Whether an item just added shows under the viewer's filters, as its list
  // decides (shownInGroups): it matches, taking the date and labels it lacks
  // from its parent, or one of its new sub-items does. Those are bare titles,
  // so they go by their parent's date and labels and have nobody on them.
  const today = useToday();
  const shownOnBoard = (item: Item, subItems: number) => {
    const parent = boardItems.find((i) => i.id === item.parentId);
    const bare = { assigneeIds: [], labels: [], dueDate: null, dueFrom: null };
    return (
      matchesFilters(item, parent, shownFilters, today) ||
      (subItems > 0 && matchesFilters(bare, item, shownFilters, today))
    );
  };
  // Items a notification or ?item= opens can be anywhere the viewer can open:
  // an archived list, or Done from before this week, which is fetched.
  const [fetchedItems, setFetchedItems] = useState<Item[]>(initialItemExtra);
  const loadedItems = projects.flatMap((p) => itemsByProject[p.id] ?? []);
  const detailItems = [
    ...loadedItems,
    ...fetchedItems.filter((f) => !loadedItems.some((i) => i.id === f.id)),
  ];
  const paletteDetail = useItemDetailDialog(detailItems, initialItemId);
  // ?item= opens the item once; a reload shouldn't open it again.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("item")) return;
    url.searchParams.delete("item");
    window.history.replaceState(null, "", url.toString());
  }, []);
  const paletteProject = projects.find(
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
  // title. With no lists on the board the viewer can add to, there's nowhere
  // to add an item — start a list instead.
  const openNewItem = useCallback(
    (projectId?: string, dueToday?: boolean) => {
      if (
        !projects.some(
          (p) => p.access === "edit" && (view === "archived" || p.status === "active"),
        )
      ) {
        setNewList({ open: true, spaceId: "" });
        return;
      }
      setNewItem({ open: true, projectId: projectId ?? null, dueToday });
    },
    [projects, view, setNewItem],
  );



  // The columns of a tray, the whole board without Spaces, or the Archived
  // view; the ⋯ menu's moves stay within the group.
  const columns = (group: ProjectView[]) =>
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
        firstId={group[0].id}
        lastId={group[group.length - 1].id}
        onShowActivity={(pid) => setAudit({ open: true, projectId: pid })}
        onAddItem={openNewItem}
        onShare={openShare}
        spaces={spaces}
        filters={shownFilters}
        aiEnabled={aiEnabled}
      />
    ));

  // Global shortcuts: ⌘K / Ctrl+K toggles the command palette, even from a
  // field. Then Linear-style bare keys: / → palette, C → new item, ⇧C → new
  // list, F → Filter, N → notifications, 1–3 → the header's views, ! → Send
  // feedback (where it's on), ? → the list of shortcuts (ShortcutsDialog,
  // which lists any new one too). Those are skipped while typing in a field,
  // and when a command modifier is held so we don't shadow ⌘C / Ctrl+C copy.
  // F, N, the views, ! and ? also wait
  // while a dialog is open (an item's, the palette), which they'd act behind,
  // as do the arrows and HJKL, which select an item (Esc lets go).
  // A, I, D, X, ⌫ and ↵ are taken: they act on the hovered or selected item
  // (useItemShortcuts).
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
        return;
      }
      if (document.querySelector('[role="dialog"]')) return;
      // An open menu or other widget keeps its own arrows and Esc.
      if (
        (e.target as Element | null)?.closest?.(
          '[role="menu"], [role="listbox"], [role="radiogroup"], [role="tablist"], [role="slider"]',
        )
      ) {
        return;
      }
      if (e.key === "Escape" && selection.get()) {
        selection.select(null);
        return;
      }
      // ? is Shift+/ on most layouts, so it comes before the Shift check.
      if (matchesShortcut(e, { key: "?" })) {
        e.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      // ! is Shift+1 on most layouts, so it comes before the Shift check too.
      if (feedbackEnabled && matchesShortcut(e, { key: "!" })) {
        e.preventDefault();
        setFeedbackAbout(null);
        setFeedbackOpen(true);
        return;
      }
      if (e.shiftKey) return;
      const dir = NAV_KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
      // Not while a row is picked up: dnd-kit moves it with the arrows.
      if (dir && !document.querySelector('[aria-pressed="true"][aria-roledescription]')) {
        const row = stepItemRow(selection.get(), dir);
        if (!row) return;
        e.preventDefault();
        selection.select(row.dataset.itemRow ?? null);
        row.scrollIntoView({ block: "nearest", inline: "nearest" });
        return;
      }
      const nextView = BOARD_VIEWS[Number(e.key) - 1]?.[0];
      if (matchesShortcut(e, { key: "f" })) {
        e.preventDefault();
        setFilterOpen((o) => !o);
      } else if (matchesShortcut(e, { key: "n" })) {
        e.preventDefault();
        setInboxOpen((o) => !o);
      } else if (nextView) {
        e.preventDefault();
        selection.select(null);
        switchView(nextView);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [openNewItem, switchView, feedbackEnabled, selection]);

  // Moving the pointer hands the shortcuts back to the hovered item. Scrolling
  // to the selection moves rows under a still pointer without moving it.
  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (e.movementX || e.movementY) selection.select(null);
    }
    document.addEventListener("pointermove", onMove);
    return () => document.removeEventListener("pointermove", onMove);
  }, [selection]);

  // On first paint, and on coming back from Agenda or Done (which unmount
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

  // Kept the same across refreshes that don't change it, like the labels.
  const accessByProject = useSameContent(
    Object.fromEntries(projects.map((p) => [p.id, p.access])),
  );

  return (
    <FollowsProvider followedItemIds={followedItemIds}>
    <SelectedItemContext value={selection}>
    <NotificationLevelsProvider levels={notificationLevels}>
    <ItemChangesContext value={itemChanges}>
    <LabelsContext value={sameLabels}>
    <ListAccessContext value={accessByProject}>
    <RemoveListContext value={removeList}>
    <BoardDrag groups={moveTargets}>
      <BoardMain>
        <BoardHeader
          nav={<ViewTabs view={view} onSwitch={switchView} />}
        >
          <FilterMenu
            open={filterOpen}
            onOpenChange={setFilterOpen}
            filters={shownFilters}
            onChange={changeFilters}
            people={people}
            labels={labelChoices}
            viewerId={viewerId}
          />
          {feedbackEnabled && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label="Send feedback"
                    aria-keyshortcuts="!"
                    onClick={() => {
                      setFeedbackAbout(null);
                      setFeedbackOpen(true);
                    }}
                  >
                    <MessageSquarePlus />
                  </Button>
                }
              />
              <TooltipContent side="bottom">
                Send feedback <Kbd>!</Kbd>
              </TooltipContent>
            </Tooltip>
          )}
          <NotificationsInbox
            open={inboxOpen}
            onOpenChange={setInboxOpen}
            notifications={notifications}
            // An archived list isn't on the board: it's in Archived.
            onOpenList={(id) => (id in trayByList ? openList(id) : switchView("archived"))}
            onOpenNotification={(n) => {
              const target = new URL(n.url, window.location.href);
              const itemId = target.searchParams.get("item");
              if (!itemId) return;
              // It can be anywhere the viewer can open: an archived list, or
              // Done from before this week, which is fetched.
              const item = detailItems.find((i) => i.id === itemId);
              if (item) {
                // Its list on the board (trayByList has the active ones); an
                // archived list's item opens over the view.
                if (item.projectId in trayByList) openList(item.projectId);
                paletteDetail.openDetail(item);
                return;
              }
              void runAction(
                getItemWithSubItemsAction(itemId).then((found) => {
                  if (found.length === 0) {
                    toast("That item isn't there any more");
                    return;
                  }
                  setFetchedItems((had) => [...had, ...found]);
                  paletteDetail.openDetail(found[0]);
                }),
                "open that item",
              );
            }}
          />
          <UserMenu
            user={viewer}
            archivedCount={archived.length}
            onShowArchived={() => switchView("archived")}
            onShowActivity={() => setAudit({ open: true })}
          />
        </BoardHeader>
        <InvitesBanner invites={pendingInvites} spaceInvites={pendingSpaceInvites} />
        {view === "brief" ? (
          <AgendaView
            projects={active}
            overdueCollapsed={overdueCollapsed}
            noDateCollapsed={noDateCollapsed}
            noDateFoldedLists={noDateFoldedLists}
            // Greets in the viewer's day, so waits for their browser's timezone.
            greet={timeZone !== null}
            onFeedback={
              feedbackEnabled
                ? (about) => {
                    setFeedbackAbout(about);
                    setFeedbackOpen(true);
                  }
                : undefined
            }
            firstName={viewer?.name?.trim().split(/\s+/)[0] || null}
            onAddForToday={() => openNewItem(undefined, true)}
            itemsByProject={itemsByProject}
            assigneesByProject={assigneesByProject}
            prLinksByItem={prLinksByItem}
            viewerId={viewerId}
            filters={shownFilters}
          />
        ) : view === "done" ? (
          <DoneView
            projects={active}
            itemsByProject={itemsByProject}
            assigneesByProject={assigneesByProject}
            prLinksByItem={prLinksByItem}
            viewerId={viewerId}
            filters={shownFilters}
            since={older?.since ?? completedSince}
            more={older?.more ?? true}
            loading={loadingDone}
            failed={doneFailed}
            onLoadMore={loadMoreDone}
            onRetry={retryDone}
          />
        ) : view === "archived" ? (
          // The one place archived lists and their items show. No rail ref:
          // ?p= follows the board's lists only. None of the switch's views is
          // on, so a title says where this is.
          <>
            <div className="flex items-center justify-between gap-2 px-3 pt-3 sm:px-4">
              <h2 className="text-sm font-semibold">Archived lists</h2>
              <Button variant="outline" size="sm" onClick={() => switchView("board")}>
                Back to board
              </Button>
            </div>
            <BoardRail>
              {archived.length === 0 ? (
                <div className="m-auto text-sm text-neutral-500">
                  No archived lists — archive one from its ⋯ menu.
                </div>
              ) : (
                columns(archived)
              )}
            </BoardRail>
          </>
        ) : (
          <BoardRail ref={railRef}>
            {spaces.length === 0 ? (
              <>
                {active.length === 0 && (
                  <div className="m-auto text-sm text-neutral-500">
                    {archived.length > 0
                      ? "Every list is archived — restore one from Archived lists in the account menu, or tap + Add list."
                      : "No lists yet — tap + Add list to start."}
                  </div>
                )}
                {columns(active)}
                <AddProjectButton onClick={() => setNewList({ open: true, spaceId: "" })} />
              </>
            ) : (
              trays.map((tray, at) => {
                const inTray = (p: ProjectView) => trayOf(p) === tray.id;
                const lists = active.filter(inTray);
                const spaceId = tray.id === "personal" ? "" : tray.id;
                const saving = movingTrays.includes(tray.id);
                return (
                  <SpaceTray
                    key={tray.id}
                    name={tray.name}
                    icon={tray.icon}
                    color={tray.color}
                    lists={lists}
                    collapsed={collapsedTrays.has(tray.id)}
                    saving={saving}
                    menu={
                      <SpaceMenu
                        editId={tray.admin ? tray.id : null}
                        name={tray.name}
                        prevId={trays[at - 1]?.id ?? null}
                        nextId={trays[at + 1]?.id ?? null}
                        firstId={trays[0].id}
                        lastId={trays[trays.length - 1].id}
                        saving={saving}
                        onMove={(ref) => moveTray(tray, ref)}
                        onSetNotifications={
                          tray.id === "personal"
                            ? undefined
                            : { spaceId: tray.id, set: (level) => setTrayNotifications(tray, level) }
                        }
                      />
                    }
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
                      // Moves stay within the tray, where the new order shows.
                      columns(lists)
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
          assigneesByProject={assigneesByProject}
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
          projects={shown.filter((p) => p.access === "edit")}
          assigneesByProject={assigneesByProject}
          viewerId={viewerId}
          initialProjectId={newItem.projectId}
          dueToday={newItem.dueToday}
          shownOnBoard={shownOnBoard}
        />

        <NewProjectDialog
          open={newList.open}
          onOpenChange={(open) => setNewList((s) => ({ ...s, open }))}
          takenPrefixes={projects.filter((p) => p.isOwner).map((p) => p.prefix)}
          spaces={spaces}
          defaultSpaceId={newList.spaceId}
        />

        <PullToSearch onOpen={() => setPaletteOpen(true)} />

        <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} feedbackEnabled={feedbackEnabled} />
        {feedbackEnabled && (
          <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} about={feedbackAbout} />
        )}
        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          lists={active}
          itemsByProject={itemsByProject}
          onNewItem={() => openNewItem()}
          onNewList={() => setNewList({ open: true, spaceId: "" })}
          onSwitchView={switchView}
          onShowActivity={() => setAudit({ open: true })}
          onShowShortcuts={() => setShortcutsOpen(true)}
          onOpenList={openList}
          onOpenItem={paletteDetail.openDetail}
          onSearch={setSearch}
        />

        {paletteDetail.item && paletteProject && (
          <ItemDetailDialog
            item={paletteDetail.item}
            parent={detailItems.find((i) => i.id === paletteDetail.item?.parentId) ?? null}
            checklist={detailItems.filter((i) => i.parentId === paletteDetail.item?.id)}
            // The same rule as the board's dialog (ProjectColumn), within the
            // item's own list.
            nestTargets={boardItems.filter(
              (i) =>
                i.projectId === paletteDetail.item?.projectId &&
                i.parentId === null &&
                i.completedAt === null &&
                i.id !== paletteDetail.item?.id,
            )}
            onOpenItem={paletteDetail.goTo}
            history={paletteDetail.history}
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
    </BoardDrag>
    </RemoveListContext>
    </ListAccessContext>
    </LabelsContext>
    </ItemChangesContext>
    </NotificationLevelsProvider>
    </SelectedItemContext>
    </FollowsProvider>
  );
}

/**
 * The Brief, Board and Done switch, with an underline under the current view
 * that slides to the next. Its own component so measuring the underline
 * re-renders only the tabs, not the board under them.
 */
function ViewTabs({ view, onSwitch }: { view: BoardView; onSwitch: (next: BoardView) => void }) {
  // The view switch's underline sits on the header's bottom border under the
  // current view, and slides to the next one. Measured, since the tabs differ
  // in width and the header's height depends on what's beside them.
  const viewTabs = useRef<HTMLDivElement>(null);
  const [underline, setUnderline] = useState<{ left: number; width: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const group = viewTabs.current;
    const header = group?.closest("[data-board-header]");
    if (!group || !header) return;
    const place = () => {
      const tab = group.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (!tab) return setUnderline(null);
      const g = group.getBoundingClientRect();
      const t = tab.getBoundingClientRect();
      const h = header.getBoundingClientRect();
      setUnderline({ left: t.left - g.left, width: t.width, top: h.bottom - g.top - 2 });
    };
    place();
    // Again once the fonts are in (the Brief's serif changes its width), and
    // whenever the header or the tabs change size: the header wrapping or the
    // window resizing. (No ResizeObserver in jsdom.)
    void document.fonts?.ready.then(place);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    ro?.observe(header);
    ro?.observe(group);
    window.addEventListener("resize", place);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [view]);

  return (
    <div
      ref={viewTabs}
      role="group"
      aria-label="View"
      // Tabs, as tall as the header's buttons beside them: 28px, 36px
      // on touch.
      className="relative flex h-7 items-stretch text-[13px] font-medium max-[360px]:text-xs touch:h-9 touch:text-sm touch:max-[360px]:text-xs"
    >
      {BOARD_VIEWS.map(([v, label, Icon], i) => (
        <Tooltip key={v}>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-pressed={view === v}
                aria-keyshortcuts={String(i + 1)}
                onClick={() => onSwitch(v)}
                // Icon and name; just the icon on phones, where the
                // header is full.
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-neutral-300 sm:px-2.5 dark:focus-visible:ring-neutral-600 [&_svg]:size-3.5 touch:[&_svg]:size-4 ${
                  view === v
                    ? "text-neutral-900 dark:text-neutral-100"
                    : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
                }`}
              >
                <Icon aria-hidden />
                {/* The Brief's name in the greeting's italic serif. */}
                <span
                  className={`max-sm:sr-only ${
                    v === "brief" ? "font-display text-[18px] leading-none font-normal tracking-[-0.01em] italic" : ""
                  }`}
                >
                  {label}
                </span>
              </button>
            }
          />
          <TooltipContent side="bottom">
            Go to {label} <Kbd>{i + 1}</Kbd>
          </TooltipContent>
        </Tooltip>
      ))}
      {underline && (
        <span
          aria-hidden
          className="pointer-events-none absolute h-0.5 rounded-full bg-neutral-900 transition-[left,width] duration-300 ease-out motion-reduce:transition-none dark:bg-neutral-100"
          style={underline}
        />
      )}
    </div>
  );
}
