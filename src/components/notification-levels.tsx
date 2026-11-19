"use client";

import { Bell } from "lucide-react";
import { createContext, type ReactNode, useContext } from "react";
import { setNotificationLevelAction } from "@/app/actions";
import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import type { NotificationLevel } from "@/core/schema";
import { runAction } from "./run-action";

/** Each level, as Settings and the menus name and explain it. */
export const LEVELS: Array<{ level: NotificationLevel; label: string; hint: string }> = [
  {
    level: "all",
    label: "All activity",
    hint: "A notification for everything others do.",
  },
  {
    level: "default",
    label: "Default",
    hint: "Notifications for what's for you and items you follow. Other activity waits in the inbox.",
  },
  {
    level: "mine",
    label: "Only for me",
    hint: "Only when you're assigned, mentioned or invited, or your agent finishes.",
  },
];

export const levelLabel = (level: NotificationLevel) =>
  LEVELS.find((l) => l.level === level)?.label ?? level;

// The levels the viewer has set, by scope ("all", "space:<id>", "list:<id>").
const LevelsContext = createContext<Record<string, NotificationLevel> | null>(null);

export function NotificationLevelsProvider({
  levels,
  children,
}: {
  levels: Record<string, NotificationLevel>;
  children: ReactNode;
}) {
  return <LevelsContext.Provider value={levels}>{children}</LevelsContext.Provider>;
}

/** Saves a scope's level, or null for what it inherits, as a held save. */
export const saveLevel = (scope: string, level: NotificationLevel | null, name: string) =>
  runAction(setNotificationLevelAction(scope, level), `change notifications for “${name}”`);

/**
 * A list's or Space's Notifications submenu: what it inherits, named for
 * where from, or a level of its own. `onChoose` saves it, held on the list
 * or Space (see AGENTS.md, "Saving changes"). Absent outside the board.
 */
export function NotificationsSubmenu({
  scope,
  parent,
  onChoose,
}: {
  /** "space:<id>" or "list:<id>". */
  scope: string;
  /** What it inherits from: a Space ("space:<id>" and its name), else everything. */
  parent: { scope: string; name: string } | null;
  onChoose: (level: NotificationLevel | null) => void;
}) {
  const levels = useContext(LevelsContext);
  if (!levels) return null;
  const own = levels[scope] ?? null;
  const inherited = (parent && levels[parent.scope]) || levels.all || "default";
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger data-replay-safe>
        <Bell />
        Notifications
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup
          value={own ?? "inherit"}
          onValueChange={(next: string) =>
            next !== (own ?? "inherit") &&
            onChoose(next === "inherit" ? null : (next as NotificationLevel))
          }
        >
          <DropdownMenuRadioItem value="inherit" closeOnClick>
            {levelLabel(inherited)} (from {parent?.name ?? "Settings"})
          </DropdownMenuRadioItem>
          {LEVELS.map(({ level, label }) => (
            <DropdownMenuRadioItem key={level} data-replay-safe value={level} closeOnClick>
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
