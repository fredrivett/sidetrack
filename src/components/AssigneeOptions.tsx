"use client";

import { Bot, Check, CircleDashed } from "lucide-react";
import type { AssigneeView } from "@/core/members";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import type { AgentOption } from "./agent-sessions";
import { assigneeName, UserAvatar } from "./UserAvatar";

/**
 * The assignee choices: an "Unassigned" row that clears everyone, then every
 * person who can edit the list (owner, editors, Space admins and members)
 * as a checkbox, so an item can
 * have several assignees. Ticking a person adds or removes just them and keeps
 * the menu open for the next; Unassigned closes it. The viewer sorts to the
 * top and carries the `I` shortcut hint (I adds or removes you).
 *
 * `selected` should be the owner's optimistic copy (useOptimisticAssignees), so
 * ticking two people quickly adds both before the first change comes back.
 * Render inside a DropdownMenuContent (avatar picker, item dialog) or the
 * row's ContextMenuSubContent; all are base-ui Menus, so these items work in each.
 * `onClear` handles Unassigned when clearing means more than `onChange([])`,
 * such as the New item dialog, which also holds people from other lists.
 */
export function AssigneeOptions({
  selected,
  assignees,
  viewerId,
  onChange,
  onClear = () => onChange([]),
  agents = [],
  onAgentChange,
}: {
  selected: string[];
  assignees: AssigneeView[];
  viewerId: string | null;
  onChange: (assigneeIds: string[]) => void;
  onClear?: () => void;
  /** The viewer's agents (useAgentAssignment): ticking one starts it on the
   * item, unticking stops it. Listed after the people, under a divider. */
  agents?: AgentOption[];
  onAgentChange?: (keyId: string, on: boolean) => void;
}) {

  // Only people who can edit the list hold its work; someone already on it
  // stays, to be unticked.
  const choices = assignees.filter((a) => a.canEdit || selected.includes(a.userId));
  const ordered = viewerId
    ? [...choices].sort((a, b) =>
        a.userId === viewerId ? -1 : b.userId === viewerId ? 1 : 0,
      )
    : choices;

  return (
    <>
      <DropdownMenuItem onClick={onClear}>
        <CircleDashed className="text-neutral-400" />
        Unassigned
        {/* mr-0.5 lines this tick up with the checkbox rows' ticks (right-2). */}
        {selected.length === 0 && <Check className="mr-0.5 ml-auto" />}
      </DropdownMenuItem>
      {ordered.map((a) => (
        <DropdownMenuCheckboxItem
          key={a.userId}
          checked={selected.includes(a.userId)}
          onCheckedChange={(on) =>
            onChange(
              on ? [...selected, a.userId] : selected.filter((id) => id !== a.userId),
            )
          }
        >
          <UserAvatar user={a} size={18} />
          <span className="truncate">{assigneeName(a)}</span>
          {a.userId === viewerId && (
            <DropdownMenuShortcut>
              <Kbd>I</Kbd>
            </DropdownMenuShortcut>
          )}
        </DropdownMenuCheckboxItem>
      ))}
      {onAgentChange && agents.length > 0 && (
        <>
          <DropdownMenuSeparator />
          {agents.map((a) => (
            <DropdownMenuCheckboxItem
              key={a.keyId}
              checked={a.working}
              // Starting or stopping an agent holds the item, so close the menu.
              closeOnClick
              onCheckedChange={(on) => onAgentChange(a.keyId, on)}
            >
              <Bot className="size-[18px] text-violet-600 dark:text-violet-400" />
              <span className="truncate">{a.name}</span>
            </DropdownMenuCheckboxItem>
          ))}
        </>
      )}
    </>
  );
}
