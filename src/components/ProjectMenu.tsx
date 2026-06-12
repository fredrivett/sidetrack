"use client";

import { useTransition } from "react";
import {
  deleteProjectAction,
  leaveProjectAction,
  reorderProjectAction,
  updateProjectAction,
} from "@/app/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { validatePrefix } from "@/lib/itemRef";

export function ProjectMenu({
  projectId,
  prevId,
  nextId,
  name,
  prefix,
  isOwner,
  onShowActivity,
  onShowDetails,
  onAddItem,
  onShare,
}: {
  projectId: string;
  prevId: string | null;
  nextId: string | null;
  name: string;
  prefix: string;
  isOwner: boolean;
  onShowActivity: (projectId: string) => void;
  onShowDetails: () => void;
  onAddItem: (projectId: string) => void;
  onShare: (projectId: string, projectName: string) => void;
}) {
  const [pending, start] = useTransition();

  function run(fn: () => Promise<unknown>) {
    start(() => {
      void fn();
    });
  }

  function editPrefix() {
    const input = prompt(
      `Item ID prefix for "${name}" (2–5 letters):`,
      prefix,
    );
    if (input === null) return;
    const normalized = input.trim().toUpperCase();
    if (normalized === prefix) return;
    const err = validatePrefix(normalized);
    if (err) {
      alert(err);
      return;
    }
    run(async () => {
      try {
        await updateProjectAction(projectId, { prefix: normalized });
      } catch {
        alert("Couldn't update the prefix. Please try again.");
      }
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
        <DropdownMenuItem onClick={onShowDetails}>
          Project details
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onAddItem(projectId)}>
          Add new item
          <DropdownMenuShortcut>
            <Kbd>C</Kbd>
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
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
        {isOwner && (
          <DropdownMenuItem onClick={() => onShare(projectId, name)}>
            Share…
          </DropdownMenuItem>
        )}
        {isOwner && (
          <DropdownMenuItem onClick={editPrefix}>
            Edit ID prefix
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {isOwner ? (
          <DropdownMenuItem
            variant="destructive"
            onClick={() => {
              if (!confirm(`Delete project "${name}" and all its items?`)) return;
              run(() => deleteProjectAction(projectId));
            }}
          >
            Delete project
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            variant="destructive"
            onClick={() => {
              if (!confirm(`Leave project "${name}"?`)) return;
              run(() => leaveProjectAction(projectId));
            }}
          >
            Leave project
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
