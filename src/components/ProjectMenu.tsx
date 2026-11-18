"use client";

import {
  Archive,
  ArchiveRestore,
  ArrowDownAZ,
  ArrowDownUp,
  Boxes,
  CalendarClock,
  CheckCheck,
  Clock,
  Hash,
  type LucideIcon,
  History,
  Info,
  LogOut,
  Plus,
  Sparkles,
  Trash2,
  Undo2,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import {
  clearDoneItemsAction,
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
import { MoveMenuItems } from "./MoveMenuItems";
import { NotificationsSubmenu, saveLevel } from "./notification-levels";
import { ARMED_MENU_ITEM, useTapToConfirm } from "./use-tap-to-confirm";
import { runAction } from "./run-action";
import { useListSave, useRemoveList } from "./use-list-saves";

// Each sort runs one way: soonest due first, newest first, A to Z, and
// Jev's highest priority first.
const SORTS: Array<[ItemSort, string, LucideIcon]> = [
  ["due", "Due date", CalendarClock],
  ["created", "Date created", Clock],
  ["title", "Name", ArrowDownAZ],
  ["priority", "Priority", Sparkles],
];

// The label for the Undo button on this menu's toasts.
const UNDO = (
  <span className="flex items-center gap-1">
    <Undo2 className="size-3.5" />
    Undo
  </span>
);

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
  doneInList,
  onShowActivity,
  onShowDetails,
  onAddItem,
  onShare,
  aiEnabled,
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
  /** Done items still showing in the list: those finished today. */
  doneInList: number;
  onShowActivity: (projectId: string) => void;
  onShowDetails: () => void;
  onAddItem: (projectId: string) => void;
  onShare: (projectId: string, projectName: string) => void;
  /** Whether Jev is set up: sorting by priority asks it. */
  aiEnabled: boolean;
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

  function restore() {
    run(() => updateProjectAction(projectId, { status: "active" }), `restore “${name}”`);
  }

  function archive() {
    save(async () => {
      if (!(await runAction(updateProjectAction(projectId, { status: "archived" }), `archive “${name}”`))) {
        return;
      }
      toast(`Archived "${name}"`, {
        description: "Restore it any time from Archived lists in the account menu.",
        action: { label: UNDO, onClick: restore },
      });
    });
  }

  // A one-off sort: it rewrites the list's order, and dragging works as
  // before afterwards. Undo puts back the order from before it.
  function sortItems(by: ItemSort, label: string) {
    save(async () => {
      const sorted = sortItemsAction(projectId, by);
      if (!(await runAction(sorted, `sort “${name}”`))) return;
      // The order from before the sort, null when it was already sorted, or
      // false when Jev couldn't rank the items by priority.
      const previous = await sorted;
      if (previous === false) {
        toast.error(`Couldn't sort "${name}" by ${label}: AI suggestions aren't available right now.`);
      } else if (previous === null) {
        toast(`"${name}" is already sorted by ${label}`);
      } else {
        toast(`Sorted "${name}" by ${label}`, {
          action: {
            label: UNDO,
            onClick: () => run(() => setItemOrderAction(projectId, previous), "undo the sort"),
          },
        });
      }
    });
  }

  // Today's done items normally stay crossed out in the list until the day
  // turns over; this sends them to Done now. Undo brings them back.
  function clearDone() {
    save(async () => {
      const cleared = clearDoneItemsAction(projectId);
      if (!(await runAction(cleared, `tidy “${name}”’s done items`))) return;
      const previous = await cleared;
      toast(
        `Moved ${doneInList} done item${doneInList === 1 ? "" : "s"} to “Done this week”`,
        {
          action: {
            label: UNDO,
            onClick: () =>
              run(
                () => updateProjectAction(projectId, { doneClearedAt: previous }),
                "bring the done items back",
              ),
          },
        },
      );
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
    save(async () => {
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
    <DropdownMenu
      onOpenChange={(open, details) => {
        // aria-disabled rather than disabled while saving, so the trigger the
        // closing menu hands focus back to keeps it; it just won't open.
        if (open && saving) return details.cancel();
        if (!open) tap.reset();
      }}
    >
      <DropdownMenuTrigger
        aria-label="List options"
        aria-disabled={saving || undefined}
        // The after: box grows the tap target to 32x40 on touch without
        // moving the ⋯, which lines up with the rows' avatars (ColumnCard).
        // It reaches right, into the column's padding, not left over the
        // add-item button.
        className="relative rounded p-1 text-neutral-500 hover:bg-neutral-100 aria-disabled:opacity-50 touch:text-lg touch:leading-6 touch:after:absolute touch:after:left-0 touch:after:-right-2 touch:after:-inset-y-1 dark:hover:bg-neutral-800"
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
        <MoveMenuItems
          prevId={prevId}
          nextId={nextId}
          firstId={firstId}
          lastId={lastId}
          onMove={(ref) => run(() => reorderProjectAction(projectId, ref), `move “${name}”`)}
        />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <ArrowDownUp />
            Sort items by
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {SORTS.filter(([by]) => aiEnabled || by !== "priority").map(([by, label, Icon]) => (
              <DropdownMenuItem key={by} onClick={() => sortItems(by, label.toLowerCase())}>
                <Icon />
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem disabled={doneInList === 0} onClick={clearDone}>
          <CheckCheck />
          Tidy done items
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onShowActivity(projectId)}>
          <History />
          Activity
        </DropdownMenuItem>
        <NotificationsSubmenu
          scope={`list:${projectId}`}
          parent={space ? { scope: `space:${space.id}`, name: space.name } : null}
          onChoose={(level) => save(() => saveLevel(`list:${projectId}`, level, name))}
        />
        <DropdownMenuSeparator />
        {status === "archived" ? (
          <DropdownMenuItem onClick={restore}>
            <ArchiveRestore />
            Restore list
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={archive}>
            <Archive />
            Archive list
          </DropdownMenuItem>
        )}
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
