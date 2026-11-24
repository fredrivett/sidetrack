"use client";

import type { DraggableAttributes, DraggableSyntheticListeners } from "@dnd-kit/core";
import {
  Bell,
  BellOff,
  CalendarDays,
  CalendarX,
  Check,
  ChevronRight,
  CircleX,
  CornerLeftUp,
  Copy,
  Eye,
  IndentDecrease,
  IndentIncrease,
  ListChecks,
  MessageSquare,
  TextAlignStart,
  Trash2,
  UserRound,
} from "lucide-react";
import {
  useCallback,
  useContext,
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import type { AssigneeView } from "@/core/members";
import type { Item, ItemPrLink } from "@/core/schema";
import { modifierSymbol } from "@/lib/keyboard";
import { type Due, quickDues, sameDue, spanDates } from "@/lib/time";
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
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { CancelItemDialog, CancelledChip } from "./CancelItem";
import { Kbd } from "@/components/ui/kbd";
import { useMediaQuery } from "@/components/ui/use-media-query";
import { toggleAssignee } from "@/lib/assignees";
import { formatItemRef } from "@/lib/itemRef";
import { sameContent } from "@/lib/same-content";
import { repeatOf } from "@/lib/repeat";
import { AssigneeOptions } from "./AssigneeOptions";
import { useCommentCount } from "./comment-counts";
import { LabelBadge, useListLabels } from "./Labels";
import { MoveToListContextMenu } from "./MoveItem";
import { DueBadge, WaitingBadge } from "./DueBadge";
import { PrLink } from "./PrLink";
import { ProjectIcon } from "./ProjectIcon";
import { RepeatBadge } from "./RepeatBadge";
import { useToday } from "./use-day-start";
import { toast } from "sonner";
import {
  NAV_KEYS,
  rowAfterDelete,
  SelectedItemContext,
  useItemShortcuts,
  useRowSelection,
} from "./useItemShortcuts";
import { useOptimisticAssignees } from "./use-optimistic-assignees";
import { useItemChanges } from "./use-optimistic-items";
import { useCopyItemRef } from "./useCopyItemRef";
import { useFollows } from "./follows";
import { agentLabel, AvatarStack, assigneeNames } from "./UserAvatar";
import { useAgentAssignment, useItemAgentSessions } from "./agent-sessions";
import { useItemSaves } from "./item-saves";
import { useListAccess } from "./list-access";
import { runAction } from "./run-action";

/** Drag wiring from the sortable wrapper that owns this row (see DraggableItemList). */
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

type ItemRowProps = {
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
  /** A sub-item's parent title, shown below its title in views across lists. */
  context?: string;
  /** The item's list, as the first tag, in views that don't group by list. */
  list?: { name: string; icon: string | null; homepageUrl: string | null };
  onOpenDetail: () => void;
};

/**
 * An item's card. Memoized on what it shows, so a board render that leaves
 * an item as it was, such as a menu opening elsewhere or a refresh that
 * returns the same item, skips its row. Its callbacks always reach the
 * latest handlers its list passed, though the row itself may not re-render.
 */
export function ItemRow(props: ItemRowProps) {
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });
  const [handlers] = useState(() => ({
    onOpenDetail: () => latest.current.onOpenDetail(),
    onToggleChecklist: () => latest.current.checklist?.onToggle(),
  }));
  const { checklist } = props;
  return (
    <MemoItemRow
      {...props}
      onOpenDetail={handlers.onOpenDetail}
      checklist={checklist && { ...checklist, onToggle: handlers.onToggleChecklist }}
    />
  );
}

function ItemRowView({
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
  list,
  onOpenDetail,
}: ItemRowProps) {
  const isDragging = drag?.isDragging ?? false;
  const [pending, start] = useTransition();
  const changes = useItemChanges();
  const saves = useItemSaves();
  // A viewer or commenter sees the row, opens it and copies its ref; nothing else.
  const canEdit = useListAccess(item.projectId) === "edit";
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [dueOpen, setDueOpen] = useState(false);
  // A board has hundreds of rows, and a menu costs more to mount than the row
  // around it, so the assignee and D menus wait until they could be used:
  // the pointer reaching the row, or the menu opening. They stay mounted
  // after, so later opens and closes animate as usual.
  const [menusWanted, setMenusWanted] = useState(false);
  const assignMenu = menusWanted || assignOpen;
  const [dueMenu, setDueMenu] = useState(false);
  const dueAnchor = useRef<HTMLDivElement>(null);
  // The item the arrow keys selected owns the shortcuts while there is one;
  // otherwise the hovered item does.
  const selection = useContext(SelectedItemContext);
  const { selected, owns } = useRowSelection(selection, item.id, hovered);
  // ⌫ asks first: the row turns red until a second ⌫ deletes it, or it stops
  // owning the shortcuts.
  const [keyDelete, setKeyDelete] = useState(false);
  if (keyDelete && !owns) setKeyDelete(false);
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
  // Closed without being done: an ✕, a dashed strike and a Cancelled chip.
  const cancelled = completed && item.cancelled;
  const [cancelOpen, setCancelOpen] = useState(false);
  const repeat = repeatOf(item);
  const listLabels = useListLabels(item.projectId);
  const commentCount = useCommentCount(item.id);
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
  const { agentOptions, setAgent } = useAgentAssignment(item, start);

  // ⌘./Ctrl+. copies the ref while the card is hovered (Linear's shortcut),
  // deferring to an open detail dialog so we don't copy the wrong ref. The
  // card shows no ref to update, so the shortcut confirms with a toast.
  const follows = useFollows();
  const following = follows?.isFollowing(item.id) ?? false;
  const { copied, copy } = useCopyItemRef(ref, {
    active: owns,
    deferToDialog: true,
    toast: true,
  });

  function toggle() {
    changes.setCompleted(item, !completed);
  }
  function del() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    changes.deleteItem(item);
  }
  function setParent(parentId: string | null) {
    changes.setParent(item, parentId);
  }
  const assign = useCallback(
    (ids: string[]) => setAssignees(item.id, ids),
    [setAssignees, item.id],
  );
  // Held: the row dims until the new date lands.
  function setDue(due: Due | null) {
    start(async () => {
      await runAction(
        saves.updateItem(item.id, due ?? { dueDate: null }),
        `change the due date of “${item.title}”`,
      );
    });
  }
  const openPicker = useCallback(() => setAssignOpen(true), []);
  const openCancel = useCallback(() => setCancelOpen(true), []);
  // I adds you, or takes you off if you're already on it, leaving anyone else.
  const toggleMe = useCallback(() => {
    assign(toggleAssignee(assigneeIds, viewerId));
    setAssignOpen(false);
  }, [assign, assigneeIds, viewerId]);

  const openDue = useCallback(() => {
    setDueMenu(true);
    setDueOpen(true);
  }, []);
  const toggleDone = useCallback(
    () => changes.setCompleted(item, item.completedAt === null),
    [changes, item],
  );
  const keyDel = useCallback(() => {
    if (keyDelete) {
      toast.dismiss(`delete-${item.id}`);
      // The selection moves on to the next item, as it leaves.
      if (selected) selection?.select(rowAfterDelete(item.id));
      changes.deleteItem(item);
      return;
    }
    setKeyDelete(true);
    toast(`Press ⌫ again to delete “${item.title}”`, { id: `delete-${item.id}` });
  }, [changes, item, keyDelete, selected, selection]);

  // Linear-style shortcuts: A opens the picker, I toggles me, D the due date,
  // X ticks it, ⌫ deletes. Armed while the card is hovered or selected, and
  // kept armed while the picker is open so the I hint on the "me" row works
  // there too — opening the picker drops `hovered` (its modal backdrop
  // swallows the pointer), so we OR in `assignOpen`. Deferred to an open
  // detail dialog so we don't act on the wrong item.
  useItemShortcuts({
    active: owns || assignOpen,
    deferToDialog: true,
    onOpenPicker: canEdit ? openPicker : undefined,
    onAssignToMe: canEdit && canAssignSelf ? toggleMe : undefined,
    onDue: canEdit && today ? openDue : undefined,
    onToggleDone: canEdit ? toggleDone : undefined,
    onCancel: canEdit && !completed ? openCancel : undefined,
    onDelete: canEdit ? keyDel : undefined,
    // ↵ only on the selected item, not one the pointer happens to rest on.
    onOpen: selected ? onOpenDetail : undefined,
  });

  function openDetail() {
    // The click that fires after a drop must not open the dialog.
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    onOpenDetail();
  }

  // The assignees' button, the same before its menu mounts as after, when
  // it's the menu's trigger.
  const assigneeButton = {
    "aria-label": [
      agents.length ? `${agents.map(agentLabel).join(", ")} on it` : "",
      assigned.length ? `Assigned to ${assigneeNames(assigned)}` : "",
      assigned.length ? "Change assignees" : "Assign",
    ]
      .filter(Boolean)
      .join(". "),
    disabled: pending,
    onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
    onKeyDown: leaveArrowsToBoard,
    className:
      assigned.length || agents.length
        ? "flex rounded-full outline-none transition focus-visible:ring-2 focus-visible:ring-neutral-400 disabled:opacity-50"
        : "rounded p-1 text-neutral-300 opacity-0 transition hover:bg-neutral-100 hover:text-neutral-600 group-hover:opacity-100 data-[popup-open]:opacity-100 disabled:opacity-50 dark:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300 [@media(hover:none)]:hidden",
  };
  const assigneeFace =
    assigned.length || agents.length ? (
      <AvatarStack users={assigned} agents={agents} size={20} unfurl />
    ) : (
      <UserRound className="size-4" />
    );

  return (
    // Item actions live in a right-click menu rather than a ⋯ button, so the
    // row stays checkbox, title, avatar with nothing reserving space beside
    // them. Disabled without hover (touch): its long-press would fight the
    // touch drag, and tapping the row opens the detail dialog, which has the
    // same actions.
    <>
    <ContextMenu
      disabled={!canHover}
      onOpenChange={(open) => {
        if (!open) setConfirmingDelete(false);
      }}
    >
      <ContextMenuTrigger
        style={{ opacity: pending ? 0.7 : 1 }}
        {...(drag && canEdit ? drag.attributes : {})}
        {...(drag && canEdit ? drag.listeners : {})}
        ref={drag?.setActivatorNodeRef}
        onPointerDownCapture={() => {
          draggedRef.current = false;
        }}
        data-item-row={item.id}
        data-parent-id={item.parentId ?? undefined}
        data-selected={selected || undefined}
        onPointerEnter={() => {
          setHovered(true);
          setMenusWanted(true);
        }}
        onPointerLeave={() => setHovered(false)}
        onClick={openDetail}
        // Pointer everywhere, like the title button and controls inside it:
        // a click opens the item, and the lifted card shows grabbing once a
        // drag starts.
        className={`group relative flex cursor-pointer items-start gap-2 rounded-lg border border-neutral-200 bg-white p-2 outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 data-selected:ring-2 data-selected:ring-neutral-400 dark:border-neutral-800 dark:bg-neutral-900 ${
          keyDelete ? "ring-2 ring-destructive! " : ""
        }${
          drag ? "touch-manipulation" : ""
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
            cancelled={cancelled}
            onShiftClick={canEdit && !completed ? openCancel : undefined}
            title={canEdit && !completed ? "Complete (X) · Shift-click to cancel (⇧X)" : undefined}
            onCheckedChange={toggle}
            readOnly={!canEdit}
            aria-label={
              cancelled
                ? canEdit ? "Reopen" : "Cancelled"
                : canEdit ? (completed ? "Uncomplete" : "Complete") : completed ? "Done" : "Not done"
            }
          />
        </span>

        <div className="min-w-0 flex-1 space-y-0.5">
          {/* Keyboard-focusable affordance for opening the detail dialog; the
              click bubbles to the row's onClick so mouse and keyboard share the
              same drag-guarded handler. */}
          <button type="button" className="block w-full space-y-0.5 text-left">
            <span
              className={`block w-full break-words text-sm ${
                completed ? "text-neutral-400" : ""
              }`}
            >
              {/* Struck through on its own, so the line stops at the title. */}
              <span className={completed ? "line-through" : undefined}>
                {item.title}
              </span>
              {/* Inline after the last word, so it marks a description
                  without adding a line to the row. The no-break space keeps it
                  from wrapping onto a line of its own. */}
              {item.description?.trim() && (
                <span className="whitespace-nowrap">
                  {"\u00a0"}
                  <TextAlignStart
                    role="img"
                    aria-label="Has description"
                    className="ml-0.5 inline size-3.5 -translate-y-px text-neutral-400"
                  />
                </span>
              )}
              {commentCount > 0 && (
                <span
                  role="img"
                  aria-label={`${commentCount} comment${commentCount === 1 ? "" : "s"}`}
                  className="whitespace-nowrap text-[11px] tabular-nums text-neutral-400"
                >
                  {"\u00a0"}
                  <MessageSquare className="ml-0.5 mr-0.5 inline size-3.5 -translate-y-px" />
                  {commentCount}
                </span>
              )}
            </span>
            {/* Below the title, so the checkbox stays on the title's line. The
                arrow up marks it as the parent, not a description. */}
            {context && (
              <span className="flex w-full items-center gap-0.5 text-[11px] text-neutral-400">
                <CornerLeftUp role="img" aria-label="Sub-item of" className="size-3 shrink-0" />
                <span className="truncate">{context}</span>
              </span>
            )}
            {(cancelled || list || item.labels.length > 0 || item.dueDate || item.smartRule || repeat) && (
              <span className="flex flex-wrap items-center gap-1">
                {cancelled && <CancelledChip item={item} />}
                {list && (
                  <span className="inline-flex max-w-full items-center gap-1 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500 dark:bg-neutral-800">
                    <ProjectIcon
                      icon={list.icon}
                      homepageUrl={list.homepageUrl}
                      name={list.name}
                      size={12}
                    />
                    <span className="truncate">{list.name}</span>
                  </span>
                )}
                {item.dueDate ? (
                  <DueBadge due={item.dueDate} from={item.dueFrom} done={completed} smart={item.smartRule} />
                ) : (
                  item.smartRule && <WaitingBadge rule={item.smartRule} />
                )}
                {repeat && (
                  <RepeatBadge repeat={repeat} completedAt={item.completedAt} />
                )}
                {item.labels.map((name) => (
                  <LabelBadge
                    key={name}
                    name={name}
                    emoji={listLabels.find((l) => l.name === name)?.emoji ?? null}
                  />
                ))}
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
        <div ref={dueAnchor} className="flex h-5 shrink-0 items-center gap-1">
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
          {!canEdit ? (
            // Who has it, with nothing to change.
            (assigned.length > 0 || agents.length > 0) && (
              <span
                role="img"
                aria-label={[
                  agents.length ? `${agents.map(agentLabel).join(", ")} on it` : "",
                  assigned.length ? `Assigned to ${assigneeNames(assigned)}` : "",
                ]
                  .filter(Boolean)
                  .join(". ")}
                className="flex"
              >
                <AvatarStack users={assigned} agents={agents} size={20} unfurl />
              </span>
            )
          ) : (
          assignMenu ? (
            <DropdownMenu open={assignOpen} onOpenChange={setAssignOpen}>
              <DropdownMenuTrigger
                {...assigneeButton}
                onClick={(e) => e.stopPropagation()}
              >
                {assigneeFace}
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
                  agents={agentOptions}
                  onAgentChange={setAgent}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            // Touch has no pointer to arrive first: the tap opens it.
            <button
              type="button"
              {...assigneeButton}
              onClick={(e) => {
                e.stopPropagation();
                setAssignOpen(true);
              }}
            >
              {assigneeFace}
            </button>
          )
          )}
          {/* D's quick dates, the same as the right-click menu's Due date;
              any other day is in the dialog. No trigger: it opens from the
              shortcut, by the row's avatar. */}
          {canEdit && today && dueMenu && (
            <DropdownMenu open={dueOpen} onOpenChange={setDueOpen}>
              <DropdownMenuContent
                anchor={dueAnchor}
                align="end"
                className="w-52"
                onClick={(e) => e.stopPropagation()}
              >
                <QuickDueItems menu="dropdown" item={item} today={today} onPick={setDue} />
                <DropdownMenuItem data-replay-safe onClick={onOpenDetail}>
                  Pick a date…
                </DropdownMenuItem>
                {item.dueDate && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem data-replay-safe onClick={() => setDue(null)}>
                      <CalendarX />
                      Clear due date
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </ContextMenuTrigger>
      {/* A sibling of the trigger, not a child, so clicks in the (portaled) menu
          don't bubble through the React tree to the row's open-detail onClick. */}
      <ContextMenuContent className="w-56">
        <ContextMenuItem data-replay-safe onClick={onOpenDetail}>
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
          <ContextMenuItem data-replay-safe closeOnClick={false} onClick={() => void copy()}>
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
          {follows && (
            <ContextMenuItem data-replay-safe onClick={() => follows.setFollowing(item, !following)}>
              {following ? <BellOff /> : <Bell />}
              {following ? "Unfollow" : "Follow"}
            </ContextMenuItem>
          )}
        </ContextMenuGroup>
        {canEdit && (
        <>
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger data-replay-safe>
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
              agents={agentOptions}
              onAgentChange={setAgent}
            />
          </ContextMenuSubContent>
        </ContextMenuSub>
        {/* The dialog's quick dates, for planning from the Agenda
            without opening each item; any other day is in the dialog. */}
        {today && (
          <ContextMenuSub>
            <ContextMenuSubTrigger data-replay-safe>
              <CalendarDays />
              Due date
              <ContextMenuShortcut>
                <Kbd>D</Kbd>
              </ContextMenuShortcut>
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-52">
              <QuickDueItems menu="context" item={item} today={today} onPick={setDue} />
              <ContextMenuItem data-replay-safe onClick={onOpenDetail}>Pick a date…</ContextMenuItem>
              {item.dueDate && (
                <>
                  <ContextMenuSeparator />
                  <ContextMenuItem data-replay-safe onClick={() => setDue(null)}>
                    <CalendarX />
                    Clear due date
                  </ContextMenuItem>
                </>
              )}
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}
        <MoveToListContextMenu item={item} />
        {!completed && (
          <ContextMenuItem data-replay-safe onClick={() => setCancelOpen(true)}>
            <CircleX />
            Cancel item…
          </ContextMenuItem>
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
        <ContextMenuItem data-replay-safe
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
          {!confirmingDelete && (
            <ContextMenuShortcut>
              <Kbd>⌫</Kbd>
            </ContextMenuShortcut>
          )}
        </ContextMenuItem>
        </>
        )}
      </ContextMenuContent>
    </ContextMenu>
    {/* Mounted once asked for: a board has hundreds of rows. */}
    {cancelOpen && <CancelItemDialog item={item} open={cancelOpen} onOpenChange={setCancelOpen} />}
    </>
  );
}

/**
 * The board's movement keys move its selection, even from the assignees'
 * button, which keeps focus after its menu closes: Base UI would open the
 * menu again on an arrow, as well as the board moving on. Letting go of
 * focus leaves the next key to the board too. Enter and Space still open it.
 */
function leaveArrowsToBoard(
  e: React.KeyboardEvent<HTMLElement> & { preventBaseUIHandler?: () => void },
) {
  if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
  if (!NAV_KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key]) return;
  e.preventBaseUIHandler?.();
  e.currentTarget.blur();
}

/**
 * The quick dates in the row's D menu and right-click Due date, with each
 * span's days. Its own component so a row only works them out when one of
 * those menus opens, not on every render of every row.
 */
function QuickDueItems({
  menu,
  item,
  today,
  onPick,
}: {
  menu: "dropdown" | "context";
  item: Item;
  today: string;
  onPick: (due: Due) => void;
}) {
  const MenuItem = menu === "dropdown" ? DropdownMenuItem : ContextMenuItem;
  return quickDues(today).map(([label, due]) => (
    <MenuItem data-replay-safe key={label} onClick={() => onPick(due)}>
      {label}
      {sameDue(item, due) ? (
        <Check className="ml-auto" />
      ) : (
        // A span's dates; Today and Tomorrow say their day already.
        due.dueFrom &&
        (menu === "dropdown" ? (
          <span className="ml-auto text-xs text-muted-foreground">
            {spanDates(due.dueFrom, due.dueDate, today)}
          </span>
        ) : (
          <ContextMenuShortcut>{spanDates(due.dueFrom, due.dueDate, today)}</ContextMenuShortcut>
        ))
      )}
    </MenuItem>
  ));
}

const MemoItemRow = memo(ItemRowView, (prev, next) =>
  (Object.keys({ ...prev, ...next }) as (keyof ItemRowProps)[]).every((k) =>
    sameContent(prev[k], next[k], 3),
  ),
);
