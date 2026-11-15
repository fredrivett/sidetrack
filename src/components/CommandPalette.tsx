"use client";

import {
  CalendarDays,
  CalendarOff,
  CircleCheck,
  Circle,
  Columns3,
  History,
  KeyRound,
  ListPlus,
  Plus,
  UserRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode } from "react";
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
  onOpenList,
  onOpenItem,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The lists on the board (active, then paused), in board order. */
  lists: ProjectView[];
  itemsByProject: Record<string, Item[]>;
  onNewItem: () => void;
  onNewList: () => void;
  onSwitchView: (view: BoardView) => void;
  onShowActivity: () => void;
  onOpenList: (projectId: string) => void;
  onOpenItem: (item: Item) => void;
}) {
  const router = useRouter();

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
    { label: "Go to Board", icon: <Columns3 />, action: () => onSwitchView("board") },
    { label: "Go to Today", icon: <CalendarDays />, action: () => onSwitchView("today") },
    { label: "Go to No date", icon: <CalendarOff />, action: () => onSwitchView("no-date") },
    { label: "Show activity", icon: <History />, action: onShowActivity },
    { label: "Profile settings", icon: <UserRound />, action: () => router.push("/settings/profile") },
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
      <Command>
        {/* Uncontrolled: cmdk keeps the search, and it unmounts with the
            dialog, so every way of closing (Esc, ⌘K, a pick) clears it. */}
        <CommandInput placeholder="Search commands, lists, items…" />
        <CommandList className="max-h-[min(24rem,60dvh)]">
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
                {list.status === "paused" && (
                  <CommandShortcut className="tracking-normal">Paused</CommandShortcut>
                )}
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

/** Renders its children only once something is typed into the palette. */
function WhenSearching({ children }: { children: ReactNode }) {
  const searching = useCommandState((state) => state.search.trim() !== "");
  return searching ? children : null;
}
