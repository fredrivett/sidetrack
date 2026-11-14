"use client";

import { Archive } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { updateProjectAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Project } from "@/core/schema";
import { ProjectIcon } from "./ProjectIcon";

/**
 * Archived lists are off the board but kept. This header menu lists them;
 * choosing one restores it to the board as active.
 */
export function ArchivedListsMenu({ lists }: { lists: Project[] }) {
  const [pending, start] = useTransition();
  if (lists.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={pending}
        render={
          // An icon and count on phones, where the header is full.
          <Button
            variant="outline"
            size="sm"
            aria-label={`Archived (${lists.length})`}
          >
            <Archive />
            <span className="sm:hidden">{lists.length}</span>
            <span className="hidden sm:inline">Archived ({lists.length})</span>
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Archived lists</DropdownMenuLabel>
          {lists.map((l) => (
            <DropdownMenuItem
              key={l.id}
              onClick={() =>
                start(async () => {
                  try {
                    await updateProjectAction(l.id, { status: "active" });
                  } catch {
                    toast.error(`Couldn't restore "${l.name}". Please try again.`);
                  }
                })
              }
            >
              <ProjectIcon
                icon={l.icon}
                homepageUrl={l.homepageUrl}
                name={l.name}
                size={16}
              />
              <span className="min-w-0 flex-1 truncate">{l.name}</span>
              <DropdownMenuShortcut>Restore</DropdownMenuShortcut>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
