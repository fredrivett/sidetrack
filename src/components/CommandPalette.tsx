"use client";

import {
  Archive,
  Bell,
  Sunrise,
  Boxes,
  CalendarDays,
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
import { type CSSProperties, type ReactNode, useEffect, useSyncExternalStore } from "react";
import type { Item } from "@/core/schema";
import { formatItemRef } from "@/lib/itemRef";
import {
  CommandDialog,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
  useCommandState,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { DialogClose } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
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
  const visibleBottom = useSyncExternalStore(
    subscribeVisualViewport,
    visualViewportBottom,
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
    { label: "Go to Board", icon: <Columns3 />, shortcut: "1", action: () => onSwitchView("board") },
    { label: "Go to Agenda", icon: <CalendarDays />, shortcut: "2", action: () => onSwitchView("agenda") },
    { label: "Go to Done", icon: <CircleCheck />, shortcut: "3", action: () => onSwitchView("done") },
    { label: "Go to Archived", icon: <Archive />, action: () => onSwitchView("archived") },
    { label: "Show activity", icon: <History />, action: onShowActivity },
    { label: "Keyboard shortcuts", icon: <Keyboard />, shortcut: "?", action: onShowShortcuts },
    { label: "Profile settings", icon: <UserRound />, action: () => router.push("/settings/profile") },
    { label: "Notifications", icon: <Bell />, action: () => router.push("/settings/notifications") },
    { label: "Agenda greeting", icon: <Sunrise />, action: () => router.push("/settings/greeting") },
    { label: "Spaces", icon: <Boxes />, action: () => router.push("/settings/spaces") },
    { label: "API keys", icon: <KeyRound />, action: () => router.push("/settings/keys") },
    { label: "GitHub webhook", icon: <GitHubMark />, action: () => router.push("/settings/github") },
  ];

  const items = lists.flatMap((list) =>
    (itemsByProject[list.id] ?? []).map((item) => ({ item, list })),
  );
  const titleOf = new Map(items.map(({ item }) => [item.id, item.title]));

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      description="Search commands, lists and items"
      className="top-4 sm:top-1/4 sm:max-w-lg"
    >
      <Command style={{ "--visible-bottom": `${visibleBottom ?? 0}px` } as CSSProperties}>
        {/* Uncontrolled: cmdk keeps the search, and it unmounts with the
            dialog, so every way of closing (Esc, ⌘K, Cancel, a pick) clears
            it. Phones get Cancel because their keyboard has no Esc and the
            list fills the screen above it, leaving no backdrop to tap. */}
        <div className="flex items-start *:data-[slot=command-input-wrapper]:flex-1">
          <CommandInput placeholder="Search commands, lists, items…" />
          <DialogClose
            render={<Button variant="ghost" size="sm" className="mt-1 h-8 touch:h-8 sm:hidden" />}
          >
            Cancel
          </DialogClose>
        </div>
        <ReportSearch onSearch={onSearch} />
        {/* On phones the list runs down to the bottom of what's visible, so
            it fits above the on-screen keyboard and grows back when it
            closes; dvh can't, as iOS lays the keyboard over the page
            without resizing it. 4.75rem is the palette's 1rem top offset,
            the search field and padding (2.75rem), and a 1rem gap below.
            It animates its real height, from cmdk's measured content
            height, so it eases with the keyboard: a max-height transition
            spends most of its time above the content and looks like a
            snap. */}
        <CommandList className="max-sm:h-[min(var(--cmdk-list-height),calc(var(--visible-bottom)-4.75rem))] max-sm:max-h-none max-sm:transition-[height] max-sm:duration-250 max-sm:ease-out sm:max-h-[min(24rem,60dvh)]">
          <CommandEmpty>No matches.</CommandEmpty>
          <CommandGroup heading="Commands">
            {commands.map((c) => (
              <CommandItem key={c.label} value={c.label} onSelect={() => run(c.action)}>
                {c.icon}
                {c.label}
                {/* Key hints mean nothing on a phone. */}
                {c.shortcut && (
                  <CommandShortcut className="max-sm:hidden">{c.shortcut}</CommandShortcut>
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
        <div className="hidden items-center justify-end gap-3 border-t px-2 pt-2 pb-1 text-xs text-muted-foreground sm:flex">
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
    </CommandDialog>
  );
}

/** Where the visible part of the page ends, in the layout viewport's pixels:
 * above the on-screen keyboard while it's open. */
function visualViewportBottom() {
  const vv = window.visualViewport;
  return vv ? vv.offsetTop + vv.height : window.innerHeight;
}

function subscribeVisualViewport(onChange: () => void) {
  const vv = window.visualViewport;
  vv?.addEventListener("resize", onChange);
  vv?.addEventListener("scroll", onChange);
  return () => {
    vv?.removeEventListener("resize", onChange);
    vv?.removeEventListener("scroll", onChange);
  };
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
