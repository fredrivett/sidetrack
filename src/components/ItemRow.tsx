"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Check, Copy, Eye, Trash2, UserRound } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  completeItemAction,
  deleteItemAction,
  uncompleteItemAction,
  updateItemAction,
} from "@/app/actions";
import type { AssigneeView } from "@/core/members";
import type { Item, ItemPrLink } from "@/core/schema";
import { modifierSymbol } from "@/lib/keyboard";
import { prLabel } from "@/lib/pr";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { formatItemRef } from "@/lib/itemRef";
import { AssigneeOptions } from "./AssigneeOptions";
import { CategoryBadge } from "./CategoryBadge";
import { useAssignShortcuts } from "./useAssignShortcuts";
import { useCopyItemRef } from "./useCopyItemRef";
import { assigneeName, UserAvatar } from "./UserAvatar";

export function ItemRow({
  item,
  prefix,
  assignees,
  viewerId,
  prLinks,
  draggable,
  onOpenDetail,
}: {
  item: Item;
  prefix: string;
  assignees: AssigneeView[];
  viewerId: string;
  prLinks: ItemPrLink[];
  draggable: boolean;
  onOpenDetail: () => void;
}) {
  const sortable = useSortable({ id: item.id, disabled: !draggable });
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    sortable;
  const [pending, start] = useTransition();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);

  // Clicking anywhere on the row opens the detail sheet, but a drag must not.
  // Track whether dnd-kit treated this gesture as a drag (per its sensors'
  // activation constraints) and swallow the click that follows a drop.
  const draggedRef = useRef(false);
  useEffect(() => {
    if (isDragging) draggedRef.current = true;
  }, [isDragging]);
  const completed = item.completedAt !== null;
  const ref = formatItemRef(prefix, item.number);
  const assignee = assignees.find((a) => a.userId === item.assigneeId);
  const canAssignSelf = useMemo(
    () => assignees.some((a) => a.userId === viewerId),
    [assignees, viewerId],
  );

  const firstLine = item.description?.split("\n", 1)[0] ?? "";
  const descriptionHasMore =
    item.description != null && item.description.length > firstLine.length;

  // ⌘./Ctrl+. copies the ref while the card is hovered (Linear's shortcut),
  // deferring to an open detail sheet so we don't copy the wrong ref.
  const { copied, copy } = useCopyItemRef(ref, {
    active: hovered,
    deferToDialog: true,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : pending ? 0.7 : 1,
  };

  function toggle() {
    start(() => {
      void (completed ? uncompleteItemAction(item.id) : completeItemAction(item.id));
    });
  }
  function del() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    start(() => {
      void deleteItemAction(item.id);
    });
  }
  const assign = useCallback(
    (assigneeId: string | null) => {
      start(() => {
        void updateItemAction(item.id, { assigneeId });
      });
    },
    [item.id],
  );
  const openPicker = useCallback(() => setAssignOpen(true), []);
  const assignToMe = useCallback(() => assign(viewerId), [assign, viewerId]);

  // Linear's assignment shortcuts while the card is hovered: A opens the picker,
  // I assigns to me. Disarmed while the picker is open (the menu owns keys then)
  // and deferred to an open detail sheet so we don't assign the wrong item.
  useAssignShortcuts({
    active: hovered && !assignOpen,
    deferToDialog: true,
    onOpenPicker: openPicker,
    onAssignToMe: canAssignSelf ? assignToMe : undefined,
  });

  function openDetail() {
    // The click that fires after a drop must not open the sheet.
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    onOpenDetail();
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(draggable ? attributes : {})}
      {...(draggable ? listeners : {})}
      onPointerDownCapture={() => {
        draggedRef.current = false;
      }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onClick={openDetail}
      className={`group relative flex items-start gap-2 rounded-lg border border-neutral-200 bg-white p-2 dark:border-neutral-800 dark:bg-neutral-900 ${
        draggable
          ? "cursor-grab touch-manipulation active:cursor-grabbing"
          : "cursor-pointer"
      } ${
        item.kind === "milestone"
          ? "border-l-4 border-l-amber-400 dark:border-l-amber-500"
          : ""
      }`}
    >
      <input
        type="checkbox"
        checked={completed}
        onChange={toggle}
        onClick={(e) => e.stopPropagation()}
        className="mt-1 h-4 w-4 shrink-0"
        aria-label={completed ? "Uncomplete" : "Complete"}
      />

      <div className="min-w-0 flex-1 space-y-0.5">
        {/* Keyboard-focusable affordance for opening the detail sheet; the
            click bubbles to the row's onClick so mouse and keyboard share the
            same drag-guarded handler. */}
        <button type="button" className="block w-full space-y-0.5 text-left">
          <span
            className={`block w-full break-words text-sm ${
              completed ? "text-neutral-400 line-through" : ""
            } ${item.kind === "milestone" ? "font-medium" : ""}`}
          >
            {item.title}
          </span>
          {item.description && (
            <span className="block w-full truncate text-xs text-neutral-500 dark:text-neutral-400">
              {firstLine}
              {descriptionHasMore && "…"}
            </span>
          )}
          {item.category && <CategoryBadge category={item.category} />}
        </button>
        {prLinks.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {prLinks.map((link) => (
              <a
                key={link.id}
                href={link.prUrl}
                target="_blank"
                rel="noreferrer noopener"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                className="inline-block rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-950/70"
              >
                {prLabel(link.prUrl)}
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Assignee avatar doubles as the picker trigger (click, or A while
          hovered). Unassigned items show a faint add-assignee button on hover. */}
      <DropdownMenu open={assignOpen} onOpenChange={setAssignOpen}>
        <DropdownMenuTrigger
          aria-label={
            assignee
              ? `Assigned to ${assigneeName(assignee)}. Reassign`
              : "Assign"
          }
          disabled={pending}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className={
            assignee
              ? "mt-0.5 shrink-0 self-start rounded-full outline-none transition focus-visible:ring-2 focus-visible:ring-neutral-400 disabled:opacity-50"
              : "mt-0.5 shrink-0 self-start rounded p-1 text-neutral-300 opacity-0 transition hover:bg-neutral-100 hover:text-neutral-600 group-hover:opacity-100 data-[popup-open]:opacity-100 disabled:opacity-50 dark:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
          }
        >
          {assignee ? (
            <UserAvatar user={assignee} size={20} />
          ) : (
            <UserRound className="size-4" />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-52"
          // Portaled out of the row in the DOM, but React events still bubble
          // through the component tree — stop them so picking an assignee doesn't
          // also open the detail sheet via the row's onClick.
          onClick={(e) => e.stopPropagation()}
        >
          <AssigneeOptions
            currentId={item.assigneeId}
            assignees={assignees}
            viewerId={viewerId}
            onPick={assign}
          />
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu
        onOpenChange={(open) => {
          if (!open) setConfirmingDelete(false);
        }}
      >
        <DropdownMenuTrigger
          aria-label="Item options"
          disabled={pending}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 self-start rounded p-1 text-neutral-300 opacity-0 transition hover:bg-neutral-100 hover:text-neutral-600 group-hover:opacity-100 disabled:opacity-50 dark:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
        >
          ⋯
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-44"
          // base-ui portals the menu out of the row in the DOM, but React
          // events still bubble through the component tree — without this a
          // click on any item would reach the row's onClick and open detail.
          onClick={(e) => e.stopPropagation()}
        >
          <DropdownMenuItem onClick={onOpenDetail}>
            <Eye className="opacity-70" />
            View item
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {/* Label + Copy ID share a Group: base-ui's GroupLabel throws if it
              isn't rendered inside a Menu.Group. */}
          <DropdownMenuGroup>
            <DropdownMenuLabel className="font-mono text-[11px] tracking-wide text-neutral-400">
              {ref}
            </DropdownMenuLabel>
            <DropdownMenuItem closeOnClick={false} onClick={() => void copy()}>
              {copied ? (
                <Check className="opacity-70" />
              ) : (
                <Copy className="opacity-70" />
              )}
              {copied ? "Copied" : "Copy ID"}
              <DropdownMenuShortcut>
                <Kbd>{modifierSymbol()}.</Kbd>
              </DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <UserRound className="opacity-70" />
              {assignee ? "Reassign" : "Assign to"}
              <DropdownMenuShortcut>
                <Kbd>A</Kbd>
              </DropdownMenuShortcut>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-52">
              <AssigneeOptions
                currentId={item.assigneeId}
                assignees={assignees}
                viewerId={viewerId}
                onPick={assign}
              />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            closeOnClick={false}
            onClick={del}
            className={
              confirmingDelete
                ? "bg-destructive! text-white! focus:bg-destructive! focus:text-white!"
                : undefined
            }
          >
            <Trash2 className={confirmingDelete ? "text-white!" : "opacity-70"} />
            {confirmingDelete ? "Confirm delete?" : "Delete item"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
