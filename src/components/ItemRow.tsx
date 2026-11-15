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
  deleteItemAction,
  setItemParentAction,
  updateItemAction,
} from "@/app/actions";
import type { AssigneeView } from "@/core/members";
import type { Item, ItemPrLink } from "@/core/schema";
import { modifierSymbol } from "@/lib/keyboard";
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
import { toggleAssignee } from "@/lib/assignees";
import { formatItemRef } from "@/lib/itemRef";
import { repeatOf } from "@/lib/repeat";
import { AssigneeOptions } from "./AssigneeOptions";
import { CategoryBadge } from "./CategoryBadge";
import { DueBadge } from "./DueBadge";
import { PrLink } from "./PrLink";
import { RepeatBadge } from "./RepeatBadge";
import { useToday } from "./use-day-start";
import { useAssignShortcuts } from "./useAssignShortcuts";
import { useOptimisticAssignees } from "./use-optimistic-assignees";
import { useSetCompleted } from "./use-optimistic-completion";
import { useCopyItemRef } from "./useCopyItemRef";
import { agentLabel, AvatarStack, assigneeNames } from "./UserAvatar";
import { useItemAgentSessions } from "./agent-sessions";

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
  const setCompleted = useSetCompleted();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const canHover = useMediaQuery("(hover: hover)");
  const today = useToday();

  // Clicking anywhere on the row opens the detail dialog, but a drag must not.
  // Track whether dnd-kit treated this gesture as a drag (per its sensors'
  // activation constraints) and swallow the click that follows a drop.
  const draggedRef = useRef(false);
  useEffect(() => {
    if (isDragging) draggedRef.current = true;
  }, [isDragging]);
  const completed = item.completedAt !== null;
  const repeat = repeatOf(item);
  const ref = formatItemRef(prefix, item.number);
  // Shown in the list's member order, so joint items line up across rows.
  const { assigneesById, setAssignees } = useOptimisticAssignees([item]);
  const assigneeIds = assigneesById[item.id];
  const assigned = assignees.filter((a) => assigneeIds.includes(a.userId));
  const canAssignSelf = useMemo(
    () => assignees.some((a) => a.userId === viewerId),
    [assignees, viewerId],
  );
  // Agents working on it lead the stack, ahead of the people assigned.
  const { agents } = useItemAgentSessions(item.id);

  // ⌘./Ctrl+. copies the ref while the card is hovered (Linear's shortcut),
  // deferring to an open detail dialog so we don't copy the wrong ref.
  const { copied, copy } = useCopyItemRef(ref, {
    active: hovered,
    deferToDialog: true,
  });

  function toggle() {
    setCompleted(item, !completed);
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
    (ids: string[]) => setAssignees(item.id, ids),
    [setAssignees, item.id],
  );
  function setDue(dueDate: string | null) {
    start(() => {
      void updateItemAction(item.id, { dueDate });
    });
  }
  const openPicker = useCallback(() => setAssignOpen(true), []);
  // I adds you, or takes you off if you're already on it, leaving anyone else.
  const toggleMe = useCallback(() => {
    assign(toggleAssignee(assigneeIds, viewerId));
    setAssignOpen(false);
  }, [assign, assigneeIds, viewerId]);

  // Linear's assignment shortcuts: A opens the picker, I toggles me. Armed
  // while the card is hovered, and kept armed while the picker is open so the I
  // hint on the "me" row works there too — opening the picker drops `hovered`
  // (its modal backdrop swallows the pointer), so we OR in `assignOpen`.
  // Deferred to an open detail dialog so we don't assign the wrong item.
  useAssignShortcuts({
    active: hovered || assignOpen,
    deferToDialog: true,
    onOpenPicker: openPicker,
    onAssignToMe: canAssignSelf ? toggleMe : undefined,
  });

  function openDetail() {
    // The click that fires after a drop must not open the dialog.
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
    // touch drag, and tapping the row opens the detail dialog, which has the
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
          // While dragged, the row stays behind as the empty slot it would
          // drop into: same size, its content hidden.
          isDragging
            ? "border-dashed border-neutral-300 bg-neutral-100 *:invisible dark:border-neutral-700 dark:bg-neutral-800/50"
            : ""
        }`}
      >
        {/* The wrapper stops the click, not the Checkbox: Base UI forwards it
            to a hidden sibling <input>, whose click would also bubble to the
            row and open the detail dialog. mt-0.5 centres the 16px circle on
            the title's 20px first line. */}
        <span className="mt-0.5 flex" onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={completed}
            onCheckedChange={toggle}
            aria-label={completed ? "Uncomplete" : "Complete"}
          />
        </span>

        <div className="min-w-0 flex-1 space-y-0.5">
          {/* Keyboard-focusable affordance for opening the detail dialog; the
              click bubbles to the row's onClick so mouse and keyboard share the
              same drag-guarded handler. */}
          <button type="button" className="block w-full space-y-0.5 text-left">
            <span
              className={`block w-full break-words text-sm ${
                completed ? "text-neutral-400 line-through" : ""
              }`}
            >
              {item.title}
            </span>
            {/* Below the title, so the checkbox stays on the title's line. */}
            {context && (
              <span className="block w-full truncate text-[11px] text-neutral-400">
                {context}
              </span>
            )}
            {(item.category || item.dueDate || repeat) && (
              <span className="flex flex-wrap items-center gap-1">
                {item.dueDate && (
                  <DueBadge due={item.dueDate} done={completed} />
                )}
                {repeat && (
                  <RepeatBadge repeat={repeat} completedAt={item.completedAt} />
                )}
                {item.category && <CategoryBadge category={item.category} />}
              </span>
            )}
          </button>
          {prLinks.length > 0 && (
            <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 pt-0.5">
              {prLinks.map((link) => (
                <PrLink key={link.id} url={link.prUrl} state={link.prState} className="text-[11px]" />
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
          {/* The assignees' avatars, overlapping on a joint item, double as
              the picker trigger (click, or A while hovered). Agents working on
              the item come first; hovering spreads the stack out. Unassigned items
              show a faint add-assignee button on hover; without hover (touch)
              it's hidden rather than left as an invisible tap target taking up
              width. */}
          <DropdownMenu open={assignOpen} onOpenChange={setAssignOpen}>
            <DropdownMenuTrigger
              aria-label={[
                agents.length ? `${agents.map(agentLabel).join(", ")} on it` : "",
                assigned.length ? `Assigned to ${assigneeNames(assigned)}` : "",
                assigned.length ? "Change assignees" : "Assign",
              ]
                .filter(Boolean)
                .join(". ")}
              disabled={pending}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              className={
                assigned.length || agents.length
                  ? "flex rounded-full outline-none transition focus-visible:ring-2 focus-visible:ring-neutral-400 disabled:opacity-50"
                  : "rounded p-1 text-neutral-300 opacity-0 transition hover:bg-neutral-100 hover:text-neutral-600 group-hover:opacity-100 data-[popup-open]:opacity-100 disabled:opacity-50 dark:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300 [@media(hover:none)]:hidden"
              }
            >
              {assigned.length || agents.length ? (
                <AvatarStack users={assigned} agents={agents} size={20} unfurl />
              ) : (
                <UserRound className="size-4" />
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent
              data-assignee-picker
              align="end"
              className="w-52"
              // Portaled out of the row in the DOM, but React events still bubble
              // through the component tree — stop them so picking an assignee doesn't
              // also open the detail dialog via the row's onClick.
              onClick={(e) => e.stopPropagation()}
            >
              <AssigneeOptions
                selected={assigneeIds}
                assignees={assignees}
                viewerId={viewerId}
                onChange={assign}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      {/* A sibling of the trigger, not a child, so clicks in the (portaled) menu
          don't bubble through the React tree to the row's open-detail onClick. */}
      <ContextMenuContent className="w-56">
        <ContextMenuItem onClick={onOpenDetail}>
          <Eye />
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
              <Check />
            ) : (
              <Copy />
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
            <UserRound />
            {assigned.length ? "Assignees" : "Assign to"}
            <ContextMenuShortcut>
              <Kbd>A</Kbd>
            </ContextMenuShortcut>
          </ContextMenuSubTrigger>
          <ContextMenuSubContent data-assignee-picker className="w-52">
            <AssigneeOptions
              selected={assigneeIds}
              assignees={assignees}
              viewerId={viewerId}
              onChange={assign}
            />
          </ContextMenuSubContent>
        </ContextMenuSub>
        {/* The dialog's quick dates, for planning from the No date view
            without opening each item; any other day is in the dialog. */}
        {today && (
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <CalendarDays />
              Due date
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-52">
              {quickDueDays(today).map(([label, day]) => (
                <ContextMenuItem key={label} onClick={() => setDue(day)}>
                  {label}
                  {item.dueDate === day ? (
                    <Check className="ml-auto" />
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
                    <CalendarX />
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
                <IndentIncrease />
                <span className="truncate">Sub-item of “{nestUnder.title}”</span>
              </ContextMenuItem>
            )}
            {parentTitle && (
              <ContextMenuItem onClick={() => setParent(null)}>
                <IndentDecrease />
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
          <Trash2 className={confirmingDelete ? "text-white!" : undefined} />
          {confirmingDelete ? "Confirm delete?" : "Delete item"}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
