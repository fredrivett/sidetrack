"use client";

import {
  Archive,
  ArrowDownAZ,
  ArrowDownUp,
  ArrowLeft,
  ArrowLeftToLine,
  ArrowRight,
  ArrowRightToLine,
  CalendarClock,
  Clock,
  Hash,
  type LucideIcon,
  History,
  Info,
  LogOut,
  Pause,
  Play,
  Plus,
  Trash2,
  UserPlus,
} from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import {
  deleteProjectAction,
  leaveProjectAction,
  reorderProjectAction,
  setItemOrderAction,
  sortItemsAction,
  updateProjectAction,
} from "@/app/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import type { ItemSort } from "@/core/items";
import type { ProjectStatus } from "@/core/schema";
import { validatePrefix } from "@/lib/itemRef";
import { ARMED_MENU_ITEM, useTapToConfirm } from "./use-tap-to-confirm";

// Each sort runs one way: soonest due first, newest first, and A to Z.
const SORTS: Array<[ItemSort, string, LucideIcon]> = [
  ["due", "Due date", CalendarClock],
  ["created", "Date created", Clock],
  ["title", "Name", ArrowDownAZ],
];

export function ProjectMenu({
  projectId,
  prevId,
  nextId,
  firstId,
  lastId,
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
  firstId: string;
  lastId: string;
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
  // Delete and Leave take a second tap: the first turns them into "Confirm …?".
  const tap = useTapToConfirm();

  function run(fn: () => Promise<unknown>) {
    start(() => {
      void fn();
    });
  }

  // Pause, Resume and Undo-archive all wait for the change and say so if it
  // fails, rather than leaving the list in the wrong state silently.
  function setStatus(next: ProjectStatus) {
    start(async () => {
      try {
        await updateProjectAction(projectId, { status: next });
      } catch {
        toast.error(`Couldn't update "${name}". Please try again.`);
      }
    });
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

  // A one-off sort: it rewrites the list's order, and dragging works as
  // before afterwards. Undo puts back the order from before it.
  function sortItems(by: ItemSort, label: string) {
    start(async () => {
      const previous = await sortItemsAction(projectId, by).catch(() => undefined);
      if (previous === undefined) {
        toast.error(`Couldn't sort "${name}". Please try again.`);
      } else if (previous === null) {
        toast(`"${name}" is already sorted by ${label}`);
      } else {
        toast(`Sorted "${name}" by ${label}`, {
          action: {
            label: "Undo",
            onClick: () =>
              start(async () => {
                await setItemOrderAction(projectId, previous).catch(() =>
                  toast.error("Couldn't undo the sort. Please try again."),
                );
              }),
          },
        });
      }
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
    <DropdownMenu onOpenChange={(open) => !open && tap.reset()}>
      <DropdownMenuTrigger
        aria-label="List options"
        disabled={pending}
        className="rounded p-1 text-neutral-500 hover:bg-neutral-100 disabled:opacity-50 dark:hover:bg-neutral-800"
      >
        ⋯
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={onShowDetails}>
          <Info />
          List details
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onAddItem(projectId)}>
          <Plus />
          Add new item
          <DropdownMenuShortcut>
            <Kbd>C</Kbd>
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!prevId}
          onClick={() =>
            run(() => reorderProjectAction(projectId, `before:${firstId}`))
          }
        >
          <ArrowLeftToLine />
          Move to start
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!prevId}
          onClick={() =>
            run(() => reorderProjectAction(projectId, `before:${prevId}`))
          }
        >
          <ArrowLeft />
          Move left
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!nextId}
          onClick={() =>
            run(() => reorderProjectAction(projectId, `after:${nextId}`))
          }
        >
          <ArrowRight />
          Move right
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!nextId}
          onClick={() =>
            run(() => reorderProjectAction(projectId, `after:${lastId}`))
          }
        >
          <ArrowRightToLine />
          Move to end
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <ArrowDownUp />
            Sort items by
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {SORTS.map(([by, label, Icon]) => (
              <DropdownMenuItem key={by} onClick={() => sortItems(by, label.toLowerCase())}>
                <Icon />
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem onClick={() => onShowActivity(projectId)}>
          <History />
          Activity
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {status === "paused" ? (
          <DropdownMenuItem onClick={() => setStatus("active")}>
            <Play />
            Resume list
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={() => setStatus("paused")}>
            <Pause />
            Pause list
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={archive}>
          <Archive />
          Archive list
        </DropdownMenuItem>
        {isOwner && (
          <DropdownMenuItem onClick={() => onShare(projectId, name)}>
            <UserPlus />
            Share…
          </DropdownMenuItem>
        )}
        {isOwner && (
          <DropdownMenuItem onClick={editPrefix}>
            <Hash />
            Edit ID prefix
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {isOwner ? (
          <DropdownMenuItem
            variant="destructive"
            closeOnClick={tap.isArmed()}
            onClick={() => tap.confirm(() => run(() => deleteProjectAction(projectId)))}
            className={tap.isArmed() ? ARMED_MENU_ITEM : undefined}
          >
            <Trash2 />
            {tap.isArmed() ? "Confirm delete?" : "Delete list"}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            variant="destructive"
            closeOnClick={tap.isArmed()}
            onClick={() => tap.confirm(() => run(() => leaveProjectAction(projectId)))}
            className={tap.isArmed() ? ARMED_MENU_ITEM : undefined}
          >
            <LogOut />
            {tap.isArmed() ? "Confirm leave?" : "Leave list"}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
