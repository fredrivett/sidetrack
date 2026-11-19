"use client";

import {
  Archive,
  Bell,
  Sunrise,
  Boxes,
  CircleCheck,
  Circle,
  Columns3,
  History,
  Keyboard,
  KeyRound,
  ListPlus,
  Plus,
  UserRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type CSSProperties, type ReactNode, useEffect, useRef, useSyncExternalStore } from "react";
import type { Item } from "@/core/schema";
import { formatItemRef } from "@/lib/itemRef";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
  useCommandState,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import type { BoardView, ProjectView } from "./Kanban";
import { GitHubMark } from "./GitHubMark";
import { ProjectIcon } from "./ProjectIcon";

/**
 * ⌘K palette: fuzzy-matches commands, the board's lists, and their items.
 * Items only show once there's a query, so the empty palette stays a short
 * list of commands and lists rather than every item on the board.
 */
export function CommandPalette({
  open,
  onOpenChange,
  lists,
  itemsByProject,
  onNewItem,
  onNewList,
  onSwitchView,
  onShowActivity,
  onShowShortcuts,
  onOpenList,
  onOpenItem,
  onSearch,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The lists on the board, in board order; archived lists stay out. */
  lists: ProjectView[];
  itemsByProject: Record<string, Item[]>;
  onNewItem: () => void;
  onNewList: () => void;
  onSwitchView: (view: BoardView) => void;
  onShowActivity: () => void;
  onShowShortcuts: () => void;
  onOpenList: (projectId: string) => void;
  onOpenItem: (item: Item) => void;
  /**
   * The search as typed, after a pause, so the board can fetch finished items
   * it hasn't loaded that match it (into `itemsByProject`).
   */
  onSearch: (search: string) => void;
}) {
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  const visibleHeight = useSyncExternalStore(
    subscribeVisualViewport,
    visualViewportHeight,
    () => undefined,
  );

  // Close first, then act, so a dialog the action opens isn't stacked under
  // the closing palette.
  function run(action: () => void) {
    onOpenChange(false);
    action();
  }

  const commands: {
    label: string;
    icon: ReactNode;
    shortcut?: string;
    action: () => void;
  }[] = [
    { label: "New item", icon: <Plus />, shortcut: "C", action: onNewItem },
    { label: "New list", icon: <ListPlus />, shortcut: "⇧C", action: onNewList },
    { label: "Go to Brief", icon: <Sunrise />, shortcut: "1", action: () => onSwitchView("brief") },
    { label: "Go to Board", icon: <Columns3 />, shortcut: "2", action: () => onSwitchView("board") },
    { label: "Go to Done", icon: <CircleCheck />, shortcut: "3", action: () => onSwitchView("done") },
    { label: "Go to Archived", icon: <Archive />, action: () => onSwitchView("archived") },
    { label: "Show activity", icon: <History />, action: onShowActivity },
    { label: "Keyboard shortcuts", icon: <Keyboard />, shortcut: "?", action: onShowShortcuts },
    { label: "Profile settings", icon: <UserRound />, action: () => router.push("/settings/profile") },
    { label: "Notifications", icon: <Bell />, action: () => router.push("/settings/notifications") },
    { label: "Brief greeting", icon: <Sunrise />, action: () => router.push("/settings/greeting") },
    { label: "Spaces", icon: <Boxes />, action: () => router.push("/settings/spaces") },
    { label: "API keys", icon: <KeyRound />, action: () => router.push("/settings/keys") },
    { label: "GitHub webhook", icon: <GitHubMark />, action: () => router.push("/settings/github") },
  ];

  const items = lists.flatMap((list) =>
    (itemsByProject[list.id] ?? []).map((item) => ({ item, list })),
  );
  const titleOf = new Map(items.map(({ item }) => [item.id, item.title]));

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      {/* A bottom sheet on phones, swiped down to close; a modal a quarter
          of the way down on desktop. */}
      <ResponsiveDialogContent
        initialFocus={searchRef}
        className="overflow-hidden data-[slot=dialog-content]:top-1/4 data-[slot=dialog-content]:translate-y-0"
      >
        <ResponsiveDialogTitle className="sr-only">Command palette</ResponsiveDialogTitle>
        <ResponsiveDialogDescription className="sr-only">
          Search commands, lists and items
        </ResponsiveDialogDescription>
        {/* In the sheet, the palette is no taller than what's visible, less
            2.5rem of backdrop above it and the 0.75rem swipe handle. The
            sheet's keyboard inset lifts its bottom above the keyboard, but
            iOS also pans the page to reveal the search field, which is
            focused while the sheet is still sliding in from below; without
            this cap the sheet keeps its full height and the pan pushes its
            top, search field and all, off the screen. */}
        <Command
          className="min-h-0 flex-1 bg-transparent in-data-[slot=drawer-content]:max-h-[calc(var(--visible-height)-3.25rem)] in-data-[slot=drawer-content]:pb-2"
          style={
            visibleHeight === undefined
              ? undefined
              : ({ "--visible-height": `${visibleHeight}px` } as CSSProperties)
          }
        >
          {/* Uncontrolled: cmdk keeps the search, and it unmounts with the
              dialog, so every way of closing (Esc, ⌘K, a swipe, a pick)
              clears it. */}
          <CommandInput ref={searchRef} placeholder="Search commands, lists, items…" />
          <ReportSearch onSearch={onSearch} />
          {/* In the sheet the list takes whatever height the sheet has left,
              which already sits above the on-screen keyboard. */}
          <CommandList className="max-h-[min(24rem,60dvh)] in-data-[slot=drawer-content]:max-h-none in-data-[slot=drawer-content]:min-h-0 in-data-[slot=drawer-content]:flex-1">
            <CommandEmpty>No matches.</CommandEmpty>
            <CommandGroup heading="Commands">
              {commands.map((c) => (
                <CommandItem key={c.label} value={c.label} onSelect={() => run(c.action)}>
                  {c.icon}
                  {c.label}
                  {/* Key hints mean nothing on a phone. */}
                  {c.shortcut && (
                    <CommandShortcut className="in-data-[slot=drawer-content]:hidden">{c.shortcut}</CommandShortcut>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandGroup heading="Lists">
              {lists.map((list) => (
                <CommandItem
                  key={list.id}
                  // Values must be unique; the prefix keeps same-named lists apart.
                  value={`${list.name} ${list.refPrefix}`}
                  onSelect={() => run(() => onOpenList(list.id))}
                >
                  <ProjectIcon
                    icon={list.icon}
                    homepageUrl={list.homepageUrl}
                    name={list.name}
                    size={16}
                  />
                  <span className="truncate">{list.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            <WhenSearching>
              <CommandGroup heading="Items">
                {items.map(({ item, list }) => {
                  const ref = formatItemRef(list.refPrefix, item.number);
                  const parent = item.parentId ? titleOf.get(item.parentId) : undefined;
                  return (
                    <CommandItem
                      key={item.id}
                      // The ref is board-unique, so it keeps duplicate titles
                      // apart and lets "SID-12" find its item.
                      value={`${item.title} ${ref}`}
                      data-item-ref={ref}
                      keywords={[list.name]}
                      onSelect={() => run(() => onOpenItem(item))}
                    >
                      {item.completedAt ? (
                        <CircleCheck className="text-muted-foreground" />
                      ) : (
                        <Circle className="text-muted-foreground" />
                      )}
                      <span className="flex min-w-0 flex-col">
                        <span
                          className={`truncate ${item.completedAt ? "text-muted-foreground line-through" : ""}`}
                        >
                          {item.title}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {[list.name, parent].filter(Boolean).join(" › ")}
                        </span>
                      </span>
                      <CommandShortcut className="tracking-normal">{ref}</CommandShortcut>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </WhenSearching>
          </CommandList>
          {/* Keyboard hints; phones have no keyboard to hint at. */}
          <div className="flex items-center justify-end gap-3 border-t px-2 pt-2 pb-1 text-xs text-muted-foreground in-data-[slot=drawer-content]:hidden">
            <span className="flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              to move
            </span>
            <span className="flex items-center gap-1">
              <Kbd>↵</Kbd>
              to open
            </span>
            <span className="flex items-center gap-1">
              <Kbd>esc</Kbd>
              to close
            </span>
          </div>
        </Command>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

/** How much of the page is visible: less the on-screen keyboard while it's
 * open, as iOS lays the keyboard over the page without resizing it. */
function visualViewportHeight() {
  return window.visualViewport?.height ?? window.innerHeight;
}

function subscribeVisualViewport(onChange: () => void) {
  const vv = window.visualViewport;
  vv?.addEventListener("resize", onChange);
  return () => vv?.removeEventListener("resize", onChange);
}

/** Passes the search up once typing pauses. */
function ReportSearch({ onSearch }: { onSearch: (search: string) => void }) {
  const search = useCommandState((state) => state.search);
  useEffect(() => {
    const timer = setTimeout(() => onSearch(search), 200);
    return () => clearTimeout(timer);
  }, [search, onSearch]);
  return null;
}

/** Renders its children only once something is typed into the palette. */
function WhenSearching({ children }: { children: ReactNode }) {
  const searching = useCommandState((state) => state.search.trim() !== "");
  return searching ? children : null;
}
