"use client";

import { Archive } from "lucide-react";
import {
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import type { Project } from "@/core/schema";
import { ProjectIcon } from "./ProjectIcon";

/**
 * Archived lists are off the board but kept. This submenu of the Account
 * menu lists them; choosing one restores it to the board as active, through
 * `onRestore`, which the menu holds while it saves.
 */
export function ArchivedListsSubmenu({
  lists,
  onRestore,
}: {
  lists: Project[];
  onRestore: (list: Project) => void;
}) {
  if (lists.length === 0) return null;
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Archive />
        Archived lists
        <DropdownMenuShortcut>{lists.length}</DropdownMenuShortcut>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-60">
        {lists.map((l) => (
          <DropdownMenuItem key={l.id} onClick={() => onRestore(l)}>
            <ProjectIcon icon={l.icon} homepageUrl={l.homepageUrl} name={l.name} size={16} />
            <span className="min-w-0 flex-1 truncate">{l.name}</span>
            <DropdownMenuShortcut>Restore</DropdownMenuShortcut>
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
