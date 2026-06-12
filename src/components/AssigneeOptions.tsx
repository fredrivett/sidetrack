"use client";

import { Check, CircleDashed } from "lucide-react";
import type { AssigneeView } from "@/core/members";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { assigneeName, UserAvatar } from "./UserAvatar";

/**
 * The assignee choices — an "Unassigned" row plus every candidate (project
 * owner + accepted members), each with a check on the current selection. Render
 * inside either a DropdownMenuContent (item sheet) or a DropdownMenuSubContent
 * (row ⋯ menu); both take DropdownMenuItem children.
 */
export function AssigneeOptions({
  currentId,
  assignees,
  onPick,
}: {
  currentId: string | null;
  assignees: AssigneeView[];
  onPick: (assigneeId: string | null) => void;
}) {
  return (
    <>
      <DropdownMenuItem onClick={() => onPick(null)}>
        <CircleDashed className="text-neutral-400" />
        Unassigned
        {currentId === null && <Check className="ml-auto opacity-70" />}
      </DropdownMenuItem>
      {assignees.map((a) => (
        <DropdownMenuItem key={a.userId} onClick={() => onPick(a.userId)}>
          <UserAvatar user={a} size={18} />
          <span className="truncate">{assigneeName(a)}</span>
          {currentId === a.userId && <Check className="ml-auto opacity-70" />}
        </DropdownMenuItem>
      ))}
    </>
  );
}
