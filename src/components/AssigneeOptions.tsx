"use client";

import { Check, CircleDashed } from "lucide-react";
import type { AssigneeView } from "@/core/members";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuShortcut,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { assigneeName, UserAvatar } from "./UserAvatar";

/**
 * The assignee choices: an "Unassigned" row that clears everyone, then every
 * candidate (project owner + accepted members) as a checkbox, so an item can
 * have several assignees. Ticking a person adds or removes just them and keeps
 * the menu open for the next; Unassigned closes it. The viewer sorts to the
 * top and carries the `I` shortcut hint (I adds or removes you).
 *
 * `selected` should be the owner's optimistic copy (useOptimisticAssignees), so
 * ticking two people quickly adds both before the first change comes back.
 * Render inside a DropdownMenuContent (avatar picker, item dialog) or the
 * row's ContextMenuSubContent; all are base-ui Menus, so these items work in each.
 */
export function AssigneeOptions({
  selected,
  assignees,
  viewerId,
  onChange,
}: {
  selected: string[];
  assignees: AssigneeView[];
  viewerId: string | null;
  onChange: (assigneeIds: string[]) => void;
}) {

  const ordered = viewerId
    ? [...assignees].sort((a, b) =>
        a.userId === viewerId ? -1 : b.userId === viewerId ? 1 : 0,
      )
    : assignees;

  return (
    <>
      <DropdownMenuItem onClick={() => onChange([])}>
        <CircleDashed className="text-neutral-400" />
        Unassigned
        {selected.length === 0 && <Check className="ml-auto" />}
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
    </>
  );
}
