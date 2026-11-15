"use client";

import {
  Archive,
  ArrowDownAZ,
  ArrowDownUp,
  ArrowLeft,
  ArrowLeftToLine,
  ArrowRight,
  ArrowRightToLine,
  Boxes,
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
import { toast } from "sonner";
import {
  reorderProjectAction,
  setItemOrderAction,
  setProjectSpaceAction,
  sortItemsAction,
  updateProjectAction,
} from "@/app/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
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
import type { SpaceView } from "@/core/spaces";
import { validatePrefix } from "@/lib/itemRef";
import { ARMED_MENU_ITEM, useTapToConfirm } from "./use-tap-to-confirm";
import { runAction } from "./run-action";
import { useListSave, useRemoveList } from "./use-list-saves";

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
  spaceId,
  spaces,
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
  /** The Space the list is in, if any. */
  spaceId: string | null;
  /** The Spaces the viewer has joined, with their role in each. */
  spaces: SpaceView[];
  onShowActivity: (projectId: string) => void;
  onShowDetails: () => void;
  onAddItem: (projectId: string) => void;
  onShare: (projectId: string, projectName: string) => void;
}) {
  // Changes to the list hold on its column until they land; deleting or
  // leaving takes it off the board at once.
  const { saving, save } = useListSave();
  const removeList = useRemoveList();
  // Delete and Leave take a second tap: the first turns them into "Confirm …?".
  const tap = useTapToConfirm();

  function run(fn: () => Promise<unknown>, what: string) {
    save(() => runAction(fn(), what));
  }

  function setStatus(next: ProjectStatus) {
    run(() => updateProjectAction(projectId, { status: next }), `update “${name}”`);
  }

  function archive() {
    save(async () => {
      if (!(await runAction(updateProjectAction(projectId, { status: "archived" }), `archive “${name}”`))) {
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
    save(async () => {
      const sorted = sortItemsAction(projectId, by);
      if (!(await runAction(sorted, `sort “${name}”`))) return;
      // The order from before the sort, or null when it was already sorted.
      const previous = await sorted;
      if (previous === null) {
        toast(`"${name}" is already sorted by ${label}`);
      } else {
        toast(`Sorted "${name}" by ${label}`, {
          action: {
            label: "Undo",
            onClick: () => run(() => setItemOrderAction(projectId, previous), "undo the sort"),
          },
        });
      }
    });
  }

  // The list's Space as the viewer sees it; undefined if they aren't in it,
  // such as an owner who left the Space their list is still in.
  const space = spaces.find((s) => s.id === spaceId);
  // Its owner moves it between Spaces they've joined; its owner or an admin
  // of its Space can take it out (core enforces the same).
  const canMove = isOwner && spaces.length > 0;
  const canTakeOut = spaceId !== null && (isOwner || space?.role === "admin");
  // Reaching a list through its Space, leaving the list alone changes nothing.
  const canLeave = !isOwner && !space;

  function moveToSpace(next: string | null) {
    const target = spaces.find((s) => s.id === next);
    start(async () => {
      if (
        await runAction(
          setProjectSpaceAction(projectId, next),
          target ? `move “${name}” into ${target.name}` : `remove “${name}” from its Space`,
        )
      ) {
        toast(
          target
            ? `Moved "${name}" into ${target.name}`
            : `Removed "${name}" from ${space?.name ?? "its Space"}`,
        );
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
    run(() => updateProjectAction(projectId, { prefix: normalized }), "update the prefix");
  }

  return (
    <DropdownMenu onOpenChange={(open) => !open && tap.reset()}>
      <DropdownMenuTrigger
        aria-label="List options"
        disabled={saving}
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
            run(() => reorderProjectAction(projectId, `before:${firstId}`), `move “${name}”`)
          }
        >
          <ArrowLeftToLine />
          Move to start
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!prevId}
          onClick={() =>
            run(() => reorderProjectAction(projectId, `before:${prevId}`), `move “${name}”`)
          }
        >
          <ArrowLeft />
          Move left
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!nextId}
          onClick={() =>
            run(() => reorderProjectAction(projectId, `after:${nextId}`), `move “${name}”`)
          }
        >
          <ArrowRight />
          Move right
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!nextId}
          onClick={() =>
            run(() => reorderProjectAction(projectId, `after:${lastId}`), `move “${name}”`)
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
        {(canMove || canTakeOut) && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Boxes />
              {isOwner ? "Move to Space" : "Space"}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {canMove && (
                <DropdownMenuRadioGroup
                  value={spaceId ?? ""}
                  onValueChange={(next: string) => next !== spaceId && moveToSpace(next)}
                >
                  {spaces.map((s) => (
                    <DropdownMenuRadioItem key={s.id} value={s.id} closeOnClick>
                      {s.icon && !s.icon.startsWith("http") && <span>{s.icon}</span>}
                      {s.name}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              )}
              {canMove && canTakeOut && <DropdownMenuSeparator />}
              {canTakeOut && (
                <DropdownMenuItem
                  variant="destructive"
                  closeOnClick={tap.isArmed("space")}
                  onClick={() => tap.confirm(() => moveToSpace(null), "space")}
                  className={tap.isArmed("space") ? ARMED_MENU_ITEM : undefined}
                >
                  <LogOut />
                  {tap.isArmed("space")
                    ? "Confirm remove?"
                    : `Remove from ${space?.name ?? "Space"}`}
                </DropdownMenuItem>
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        {isOwner && (
          <DropdownMenuItem onClick={editPrefix}>
            <Hash />
            Edit ID prefix
          </DropdownMenuItem>
        )}
        {(isOwner || canLeave) && <DropdownMenuSeparator />}
        {isOwner ? (
          <DropdownMenuItem
            variant="destructive"
            closeOnClick={tap.isArmed()}
            onClick={() => tap.confirm(() => removeList({ id: projectId, name, kind: "delete" }))}
            className={tap.isArmed() ? ARMED_MENU_ITEM : undefined}
          >
            <Trash2 />
            {tap.isArmed() ? "Confirm delete?" : "Delete list"}
          </DropdownMenuItem>
        ) : canLeave && (
          <DropdownMenuItem
            variant="destructive"
            closeOnClick={tap.isArmed()}
            onClick={() => tap.confirm(() => removeList({ id: projectId, name, kind: "leave" }))}
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
