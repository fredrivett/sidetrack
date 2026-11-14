"use client";

import type { DraggableAttributes, DraggableSyntheticListeners } from "@dnd-kit/core";
import {
  CalendarDays,
  CalendarX,
  Check,
  ChevronRight,
  Copy,
  Eye,
  IndentDecrease,
  IndentIncrease,
  ListChecks,
  Trash2,
  UserRound,
} from "lucide-react";
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
  setItemParentAction,
  uncompleteItemAction,
  updateItemAction,
} from "@/app/actions";
import type { AssigneeView } from "@/core/members";
import type { Item, ItemPrLink } from "@/core/schema";
import { modifierSymbol } from "@/lib/keyboard";
import { prLabel } from "@/lib/pr";
import { dueLabel, quickDueDays } from "@/lib/time";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { Kbd } from "@/components/ui/kbd";
import { useMediaQuery } from "@/components/ui/use-media-query";
import { formatItemRef } from "@/lib/itemRef";
import { AssigneeOptions } from "./AssigneeOptions";
import { CategoryBadge } from "./CategoryBadge";
import { DueBadge } from "./DueBadge";
import { useToday } from "./use-day-start";
import { useAssignShortcuts } from "./useAssignShortcuts";
import { useCopyItemRef } from "./useCopyItemRef";
import { assigneeName, UserAvatar } from "./UserAvatar";

/** Drag wiring from the sortable wrapper that owns this row (see ItemList). */
export type RowDrag = {
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
  /** The row itself, so Space on its checkbox or title doesn't pick it up. */
  setActivatorNodeRef: (el: HTMLElement | null) => void;
  isDragging: boolean;
};

/** A parent's checklist progress, and whether its sub-items are showing. */
export type RowChecklist = {
  done: number;
  total: number;
  expanded: boolean;
  onToggle: () => void;
};

export function ItemRow({
  item,
  prefix,
  assignees,
  viewerId,
  prLinks,
  drag,
  checklist,
  nestUnder,
  parentTitle,
  context,
  onOpenDetail,
}: {
  item: Item;
  prefix: string;
  assignees: AssigneeView[];
  viewerId: string;
  prLinks: ItemPrLink[];
  /** Present when the row can be dragged. */
  drag?: RowDrag;
  checklist?: RowChecklist;
  /** The task this row can become a sub-item of (the one above it). */
  nestUnder?: { id: string; title: string };
  /** For a sub-item, its parent's title (offers "Move out of …"). */
  parentTitle?: string;
  /** Where the item lives, shown below its title in views across lists. */
  context?: string;
  onOpenDetail: () => void;
}) {
  const isDragging = drag?.isDragging ?? false;
  const [pending, start] = useTransition();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const canHover = useMediaQuery("(hover: hover)");
  const today = useToday();

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
  function setParent(parentId: string | null) {
    start(() => {
      void setItemParentAction(item.id, parentId);
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
  function setDue(dueDate: string | null) {
    start(() => {
      void updateItemAction(item.id, { dueDate });
    });
  }
  const openPicker = useCallback(() => setAssignOpen(true), []);
  const assignToMe = useCallback(() => {
    assign(viewerId);
    setAssignOpen(false);
  }, [assign, viewerId]);

  // Linear's assignment shortcuts: A opens the picker, I assigns to me. Armed
  // while the card is hovered, and kept armed while the picker is open so the I
  // hint on the "me" row works there too — opening the picker drops `hovered`
  // (its modal backdrop swallows the pointer), so we OR in `assignOpen`.
  // Deferred to an open detail sheet so we don't assign the wrong item.
  useAssignShortcuts({
    active: hovered || assignOpen,
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
    // Item actions live in a right-click menu rather than a ⋯ button, so the
    // row stays checkbox, title, avatar with nothing reserving space beside
    // them. Disabled without hover (touch): its long-press would fight the
    // touch drag, and tapping the row opens the detail sheet, which has the
    // same actions.
    <ContextMenu
      disabled={!canHover}
      onOpenChange={(open) => {
        if (!open) setConfirmingDelete(false);
      }}
    >
      <ContextMenuTrigger
        style={{ opacity: pending ? 0.7 : 1 }}
        {...(drag ? drag.attributes : {})}
        {...(drag ? drag.listeners : {})}
        ref={drag?.setActivatorNodeRef}
        onPointerDownCapture={() => {
          draggedRef.current = false;
        }}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onClick={openDetail}
        className={`group relative flex items-start gap-2 rounded-lg border border-neutral-200 bg-white p-2 outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:border-neutral-800 dark:bg-neutral-900 ${
          drag
            ? "cursor-grab touch-manipulation active:cursor-grabbing"
            : "cursor-pointer"
        } ${
          item.kind === "milestone"
            ? "border-l-4 border-l-amber-400 dark:border-l-amber-500"
            : ""
        }`}
      >
        {/* The wrapper stops the click, not the Checkbox: Base UI forwards it
            to a hidden sibling <input>, whose click would also bubble to the
            row and open the detail sheet. mt-0.5 centres the 16px circle on
            the title's 20px first line. */}
        <span className="mt-0.5 flex" onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={completed}
            onCheckedChange={toggle}
            aria-label={completed ? "Uncomplete" : "Complete"}
          />
        </span>

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
            {/* Below the title, so the checkbox stays on the title's line. */}
            {context && (
              <span className="block w-full truncate text-[11px] text-neutral-400">
                {context}
              </span>
            )}
            {item.description && (
              <span className="block w-full truncate text-xs text-neutral-500 dark:text-neutral-400">
                {firstLine}
                {descriptionHasMore && "…"}
              </span>
            )}
            {(item.category || item.dueDate) && (
              <span className="flex flex-wrap items-center gap-1">
                {item.dueDate && (
                  <DueBadge due={item.dueDate} done={completed} />
                )}
                {item.category && <CategoryBadge category={item.category} />}
              </span>
            )}
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

        {/* The checklist progress and avatar sit in a box one title-line tall
            so they centre on the first line however many lines the title
            wraps to, and a parent row is no taller than any other. */}
        <div className="flex h-5 shrink-0 items-center gap-1">
          {checklist && (
            // Progress doubles as the show/hide toggle for the sub-items.
            <button
              type="button"
              aria-expanded={checklist.expanded}
              aria-label={`${checklist.expanded ? "Hide" : "Show"} checklist, ${checklist.done} of ${checklist.total} done`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                checklist.onToggle();
              }}
              className={`inline-flex h-5 items-center gap-1 rounded px-1 text-[11px] font-medium tabular-nums transition hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                checklist.done === checklist.total
                  ? "text-green-600 dark:text-green-500"
                  : "text-neutral-500 dark:text-neutral-400"
              }`}
            >
              <ListChecks className="size-3.5" />
              {checklist.done}/{checklist.total}
              <ChevronRight
                className={`size-3 transition-transform ${checklist.expanded ? "rotate-90" : ""}`}
              />
            </button>
          )}
          {/* Assignee avatar doubles as the picker trigger (click, or A while
              hovered). Unassigned items show a faint add-assignee button on
              hover; without hover (touch) it's hidden rather than left as an
              invisible tap target taking up width. */}
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
                  ? "flex rounded-full outline-none transition focus-visible:ring-2 focus-visible:ring-neutral-400 disabled:opacity-50"
                  : "rounded p-1 text-neutral-300 opacity-0 transition hover:bg-neutral-100 hover:text-neutral-600 group-hover:opacity-100 data-[popup-open]:opacity-100 disabled:opacity-50 dark:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300 [@media(hover:none)]:hidden"
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
        </div>
      </ContextMenuTrigger>
      {/* A sibling of the trigger, not a child, so clicks in the (portaled) menu
          don't bubble through the React tree to the row's open-detail onClick. */}
      <ContextMenuContent className="w-56">
        <ContextMenuItem onClick={onOpenDetail}>
          <Eye className="opacity-70" />
          View item
        </ContextMenuItem>
        <ContextMenuSeparator />
        {/* Label + Copy ID share a Group: base-ui's GroupLabel throws if it
            isn't rendered inside a Menu.Group. */}
        <ContextMenuGroup>
          <ContextMenuLabel className="font-mono text-[11px] tracking-wide text-neutral-400">
            {ref}
          </ContextMenuLabel>
          <ContextMenuItem closeOnClick={false} onClick={() => void copy()}>
            {copied ? (
              <Check className="opacity-70" />
            ) : (
              <Copy className="opacity-70" />
            )}
            {copied ? "Copied" : "Copy ID"}
            <ContextMenuShortcut>
              <Kbd>{modifierSymbol()}.</Kbd>
            </ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <UserRound className="opacity-70" />
            {assignee ? "Reassign" : "Assign to"}
            <ContextMenuShortcut>
              <Kbd>A</Kbd>
            </ContextMenuShortcut>
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-52">
            <AssigneeOptions
              currentId={item.assigneeId}
              assignees={assignees}
              viewerId={viewerId}
              onPick={assign}
            />
          </ContextMenuSubContent>
        </ContextMenuSub>
        {/* The sheet's quick dates, for planning from the No date view
            without opening each item; any other day is in the sheet. */}
        {today && (
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <CalendarDays className="opacity-70" />
              Due date
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-52">
              {quickDueDays(today).map(([label, day]) => (
                <ContextMenuItem key={label} onClick={() => setDue(day)}>
                  {label}
                  {item.dueDate === day ? (
                    <Check className="ml-auto opacity-70" />
                  ) : (
                    label !== "Today" &&
                    label !== "Tomorrow" && (
                      <ContextMenuShortcut>{dueLabel(day, today)}</ContextMenuShortcut>
                    )
                  )}
                </ContextMenuItem>
              ))}
              <ContextMenuItem onClick={onOpenDetail}>Pick a date…</ContextMenuItem>
              {item.dueDate && (
                <>
                  <ContextMenuSeparator />
                  <ContextMenuItem onClick={() => setDue(null)}>
                    <CalendarX className="opacity-70" />
                    Clear due date
                  </ContextMenuItem>
                </>
              )}
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}
        {(nestUnder || parentTitle) && (
          <>
            <ContextMenuSeparator />
            {nestUnder && (
              <ContextMenuItem onClick={() => setParent(nestUnder.id)}>
                <IndentIncrease className="opacity-70" />
                <span className="truncate">Sub-item of “{nestUnder.title}”</span>
              </ContextMenuItem>
            )}
            {parentTitle && (
              <ContextMenuItem onClick={() => setParent(null)}>
                <IndentDecrease className="opacity-70" />
                <span className="truncate">Move out of “{parentTitle}”</span>
              </ContextMenuItem>
            )}
          </>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem
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
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
