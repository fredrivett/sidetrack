"use client";

import { Check, CircleDashed } from "lucide-react";
import type { AssigneeView } from "@/core/members";
import {
  DropdownMenuItem,
  DropdownMenuShortcut,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { assigneeName, UserAvatar } from "./UserAvatar";

/**
 * The assignee choices — an "Unassigned" row, then every candidate (project
 * owner + accepted members) with a check on the current selection. The viewer
 * sorts to the top of the candidate list and carries the `I` ("assign to me")
 * shortcut hint, unless they're already the assignee (where the check wins).
 * Render inside either a DropdownMenuContent (item sheet) or a
 * DropdownMenuSubContent (row ⋯ menu); both take DropdownMenuItem children.
 */
export function AssigneeOptions({
  currentId,
  assignees,
  viewerId,
  onPick,
}: {
  currentId: string | null;
  assignees: AssigneeView[];
  viewerId: string | null;
  onPick: (assigneeId: string | null) => void;
}) {
  const ordered = viewerId
    ? [...assignees].sort((a, b) =>
        a.userId === viewerId ? -1 : b.userId === viewerId ? 1 : 0,
      )
    : assignees;

  return (
    <>
      <DropdownMenuItem onClick={() => onPick(null)}>
        <CircleDashed className="text-neutral-400" />
        Unassigned
        {currentId === null && <Check className="ml-auto opacity-70" />}
      </DropdownMenuItem>
      {ordered.map((a) => {
        const isCurrent = currentId === a.userId;
        const isViewer = a.userId === viewerId;
        return (
          <DropdownMenuItem key={a.userId} onClick={() => onPick(a.userId)}>
            <UserAvatar user={a} size={18} />
            <span className="truncate">{assigneeName(a)}</span>
            {isCurrent ? (
              <Check className="ml-auto opacity-70" />
            ) : isViewer ? (
              <DropdownMenuShortcut>
                <Kbd>I</Kbd>
              </DropdownMenuShortcut>
            ) : null}
          </DropdownMenuItem>
        );
      })}
    </>
  );
}
