"use client";

import { useTransition } from "react";
import { toast } from "sonner";
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
import type { ProjectStatus } from "@/core/schema";
import { validatePrefix } from "@/lib/itemRef";

export function ProjectMenu({
  projectId,
  prevId,
  nextId,
  name,
  prefix,
  status,
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
  status: ProjectStatus;
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

  function setStatus(next: ProjectStatus) {
    run(() => updateProjectAction(projectId, { status: next }));
  }

  function archive() {
    start(async () => {
      try {
        await updateProjectAction(projectId, { status: "archived" });
      } catch {
        toast.error(`Couldn't archive "${name}". Please try again.`);
        return;
      }
      toast(`Archived "${name}"`, {
        description: "Restore it any time from Archived in the header.",
        action: { label: "Undo", onClick: () => setStatus(status) },
      });
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
        aria-label="List options"
        disabled={pending}
        className="rounded p-1 text-neutral-500 hover:bg-neutral-100 disabled:opacity-50 dark:hover:bg-neutral-800"
      >
        ⋯
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={onShowDetails}>
          List details
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
        <DropdownMenuSeparator />
        {status === "paused" ? (
          <DropdownMenuItem onClick={() => setStatus("active")}>
            Resume list
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={() => setStatus("paused")}>
            Pause list
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={archive}>Archive list</DropdownMenuItem>
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
              if (!confirm(`Delete list "${name}" and all its items? To keep them, archive it instead.`)) return;
              run(() => deleteProjectAction(projectId));
            }}
          >
            Delete list
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            variant="destructive"
            onClick={() => {
              if (!confirm(`Leave list "${name}"?`)) return;
              run(() => leaveProjectAction(projectId));
            }}
          >
            Leave list
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
