"use client";

import { useTransition } from "react";
import {
  deleteProjectAction,
  reorderProjectAction,
} from "@/app/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ProjectMenu({
  projectId,
  prevId,
  nextId,
  name,
  onShowActivity,
}: {
  projectId: string;
  prevId: string | null;
  nextId: string | null;
  name: string;
  onShowActivity: (projectId: string) => void;
}) {
  const [pending, start] = useTransition();

  function run(fn: () => Promise<unknown>) {
    start(() => {
      void fn();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Project options"
        disabled={pending}
        className="rounded p-1 text-neutral-500 hover:bg-neutral-100 disabled:opacity-50 dark:hover:bg-neutral-800"
      >
        ⋯
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem
          disabled={!prevId}
          onClick={() =>
            run(() => reorderProjectAction(projectId, `before:${prevId}`))
          }
        >
          Move left
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!nextId}
          onClick={() =>
            run(() => reorderProjectAction(projectId, `after:${nextId}`))
          }
        >
          Move right
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onShowActivity(projectId)}>
          Activity
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => {
            if (!confirm(`Delete project "${name}" and all its items?`)) return;
            run(() => deleteProjectAction(projectId));
          }}
        >
          Delete project
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
