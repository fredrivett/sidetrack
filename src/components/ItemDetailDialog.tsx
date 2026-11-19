"use client";

import {
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Copy,
  CornerLeftUp,
  ExternalLink,
  GitBranch,
  IndentDecrease,
  IndentIncrease,
  Repeat as RepeatIcon,
  Trash2,
  UserRound,
} from "lucide-react";
import { unstable_rethrow } from "next/navigation";
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  startTransition,
  useTransition,
} from "react";
import {
  addItemAction,
  listAuditAction,
  updateItemAction,
} from "@/app/actions";
import type { AuditEntryWithActor } from "@/core/audit";
import type { LabelEmoji } from "@/core/labels";
import type { AssigneeView } from "@/core/members";
import type { AgentSession, Item, ItemPrLink } from "@/core/schema";
import { toggleAssignee } from "@/lib/assignees";
import { formatItemRef } from "@/lib/itemRef";
import { modifierSymbol } from "@/lib/keyboard";
import { type Repeat, repeatOf } from "@/lib/repeat";
import { dayLabel, type Due, formatRelative } from "@/lib/time";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ResponsiveDialog,
  ResponsiveDialogBackButton,
  ResponsiveDialogCloseButton,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
  ResponsiveDialogViews,
} from "@/components/ui/responsive-dialog";
import { AssigneeOptions } from "./AssigneeOptions";
import { AuditEntryRow } from "./AuditDialog";
import { useDueLabel } from "./DueBadge";
import { DueDatePicker } from "./DueDatePicker";
import { PrLink } from "./PrLink";
import { shortLabel } from "./RepeatBadge";
import { RepeatPicker } from "./RepeatPicker";
import { runAction } from "./run-action";
import { EditableText } from "./EditableText";
import { ItemComments } from "./ItemComments";
import { LabelChips } from "./Labels";
import { MoveToListPicker, useMoveItem } from "./MoveItem";
import { InlineCode, Markdown } from "./Markdown";
import { rowAfterDelete, SelectedItemContext, useItemShortcuts } from "./useItemShortcuts";
import { useOptimisticAssignees } from "./use-optimistic-assignees";
import type { ItemHistory } from "./use-item-detail-dialog";
import { useItemChanges } from "./use-optimistic-items";
import { useCopyItemRef } from "./useCopyItemRef";
import { useFollows } from "./follows";
import { AgentAvatar, AvatarStack, assigneeName, assigneeNames } from "./UserAvatar";
import { useAgentAssignment, useItemAgentSessions } from "./agent-sessions";

/**
 * The agents working on the item, each with its status, latest note, thread
 * and branch, then a line for the agent that finished most recently.
 */
function AgentWork({
  item,
  assignees,
}: {
  item: Item;
  assignees: AssigneeView[];
}) {
  const { sessions, agents } = useItemAgentSessions(item.id);
  let last: (AgentSession & { finishedAt: number }) | null = null;
  for (const s of sessions) {
    if (s.finishedAt !== null && (!last || s.finishedAt > last.finishedAt)) {
      last = { ...s, finishedAt: s.finishedAt };
    }
  }
  if (agents.length === 0 && !last) return null;
  return (
    <Field label={agents.length > 1 ? "Agents" : "Agent"}>
      <div className="space-y-2">
        {agents.map(({ session: s, ...agent }) => {
          const owner = assignees.find((a) => a.userId === s.userId);
          return (
            <div
              key={s.id}
              className="space-y-1.5 rounded-lg border border-neutral-200 p-2.5 text-sm dark:border-neutral-800"
            >
              <div className="flex flex-wrap items-center gap-2">
                <AgentAvatar agent={agent} size={22} ringClassName="ring-popover" />
                <span className="font-medium">{s.agentName}</span>
                <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-950 dark:text-violet-300">
                  Agent
                </span>
                <span className="ml-auto flex items-center gap-1.5 text-xs text-neutral-500">
                  <span
                    className={`size-1.5 rounded-full ${agent.status === "working" ? "bg-green-500" : "bg-neutral-400"}`}
                  />
                  <span className="text-neutral-700 dark:text-neutral-200">
                    {agent.status === "working" ? "Working" : "Idle"}
                  </span>
                  · {formatRelative(s.lastActiveAt)}
                </span>
              </div>
              {s.note && (
                <p className="break-words text-neutral-700 dark:text-neutral-200">{s.note}</p>
              )}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                {s.threadUrl && <ThreadLink url={s.threadUrl}>Open thread</ThreadLink>}
                {s.branch && (
                  <span className="inline-flex min-w-0 items-center gap-1 text-neutral-500">
                    <GitBranch className="size-3 shrink-0" />
                    <span className="truncate font-mono">{s.branch}</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-neutral-400">
                Started {formatRelative(s.startedAt)}
                {owner ? `, for ${assigneeName(owner)}` : ""}
              </p>
            </div>
          );
        })}
        {last && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-500">
            <AgentAvatar agent={{ id: last.id, name: last.agentName }} size={18} />
            <span className="min-w-0 break-words">
              {last.agentName} finished {formatRelative(last.finishedAt)}
              {last.note ? `: ${last.note}` : ""}
            </span>
            {last.threadUrl && <ThreadLink url={last.threadUrl}>Thread</ThreadLink>}
          </div>
        )}
      </div>
    </Field>
  );
}

const ACTIVITY_PAGE = 50;

/**
 * The item's and its sub-items' history, newest first, collapsed until
 * opened so the dialog doesn't read the log for every item it shows. While
 * open it reloads whenever the item does, so a change made here shows up
 * straight away.
 */
function ItemActivity({ item }: { item: Item }) {
  const [expanded, setExpanded] = useState(false);
  const [limit, setLimit] = useState(ACTIVITY_PAGE);
  const [entries, setEntries] = useState<AuditEntryWithActor[] | null>(null);
  const [pending, start] = useTransition();

  // Switching to another item (a sub-item or the parent) drops the last
  // one's history rather than showing it until the new one loads.
  const [prevId, setPrevId] = useState(item.id);
  if (prevId !== item.id) {
    setPrevId(item.id);
    setEntries(null);
    setLimit(ACTIVITY_PAGE);
  }

  useEffect(() => {
    if (!expanded) return;
    let stale = false;
    start(async () => {
      await runAction(
        listAuditAction({ itemId: item.id, limit }).then(
          (rows) => {
            if (!stale) setEntries(rows);
          },
          // Once the dialog has moved on, a failed load is moot, but a
          // signed-out session's redirect to /login still goes through.
          (error) => {
            unstable_rethrow(error);
            if (!stale) throw error;
          },
        ),
        "load the item's activity",
      );
    });
    return () => {
      stale = true;
    };
  }, [expanded, item, limit]);

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        data-replay-safe
        className="flex items-center gap-1 text-xs font-medium text-neutral-500 transition touch:-my-2 touch:py-2 touch:pr-4 hover:text-neutral-700 dark:hover:text-neutral-300"
      >
        <ChevronRight
          className={`size-3.5 transition-transform ${expanded ? "rotate-90" : ""}`}
        />
        Activity
      </button>
      {expanded &&
        (entries === null ? (
          <p className="text-sm text-neutral-400">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-neutral-400">No activity yet.</p>
        ) : (
          <>
            <ul className="space-y-2.5">
              {entries.map((e) => (
                <AuditEntryRow key={e.id} entry={e} />
              ))}
            </ul>
            {entries.length === limit && limit < 500 && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={pending}
                onClick={() => setLimit((l) => Math.min(l + ACTIVITY_PAGE, 500))}
              >
                {pending ? "Loading…" : "Show more"}
              </Button>
            )}
          </>
        ))}
    </div>
  );
}

function ThreadLink({ url, children }: { url: string; children: React.ReactNode }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline dark:text-blue-300"
    >
      {children}
      <ExternalLink className="size-3" />
    </a>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <span data-replay-safe className="block text-xs font-medium text-neutral-500">
        {label}
      </span>
      {children}
    </div>
  );
}

/** A field in the dialog's chip bar, set. */
const CHIP =
  "inline-flex h-7 max-w-full min-w-0 shrink-0 items-center gap-1.5 rounded-full border border-input px-2.5 text-sm transition hover:bg-muted aria-disabled:pointer-events-none aria-disabled:opacity-50 data-popup-open:bg-muted touch:h-9 touch:px-3 [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-muted-foreground";
/** A field in the chip bar with nothing set: dashed, its name in grey. */
const EMPTY_CHIP = `${CHIP} border-dashed text-muted-foreground hover:text-foreground`;

/**
 * The due date as a chip: when it's due, red once overdue and amber on the
 * day, opening the quick dates and the calendar. Picking one closes it.
 */
function DueChip({
  item,
  done,
  disabled,
  onChange,
  open,
  setOpen,
}: {
  item: Item;
  done: boolean;
  disabled: boolean;
  onChange: (due: Due | null) => void;
  /** Open, as the D shortcut leaves it. */
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const due = item.dueDate ? { dueDate: item.dueDate, dueFrom: item.dueFrom } : null;
  return (
    <Popover open={open} onOpenChange={(next) => setOpen(next && !disabled)}>
      <PopoverTrigger aria-disabled={disabled || undefined} className={due ? CHIP : EMPTY_CHIP}>
        <CalendarDays />
        {due ? <DueChipLabel due={due} done={done} /> : <span data-replay-safe>Due date</span>}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] p-2">
        <DueDatePicker
          key={item.id}
          due={due}
          done={done}
          disabled={disabled}
          onChange={(next) => {
            setOpen(false);
            onChange(next);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function DueChipLabel({ due, done }: { due: Due; done: boolean }) {
  const { label, tone } = useDueLabel(due.dueDate, due.dueFrom, done);
  return (
    <span
      data-replay-safe
      className={
        tone === "overdue"
          ? "text-red-600 dark:text-red-400"
          : tone === "today"
            ? "text-amber-700 dark:text-amber-300"
            : ""
      }
    >
      <span className="sr-only">Due </span>
      {label}
    </span>
  );
}

/** How the item repeats as a chip, opening the repeat picker. */
function RepeatChip({
  item,
  disabled,
  onChange,
}: {
  item: Item;
  disabled: boolean;
  onChange: (repeat: Repeat | null) => void;
}) {
  const repeat = repeatOf(item);
  return (
    <Popover>
      <PopoverTrigger aria-disabled={disabled || undefined} className={repeat ? CHIP : EMPTY_CHIP}>
        <RepeatIcon />
        <span data-replay-safe>{repeat ? shortLabel(repeat) : "Repeat"}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] p-2">
        <RepeatPicker
          key={item.id}
          repeat={repeat}
          completedAt={item.completedAt}
          disabled={disabled}
          onChange={onChange}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * A task's sub-items, each ticked off in place, with an input that stays
 * focused after Enter so a whole checklist goes in one line after another.
 */
function Checklist({
  parent,
  prefix,
  items,
  assignees,
  viewerId,
  onOpenItem,
  assigneesById,
  onAssign,
  pickerFor,
  onPickerFor,
  focusId,
}: {
  parent: Item;
  /** The list's ref prefix, for ⌘. on a hovered sub-item. */
  prefix: string;
  items: Item[];
  assignees: AssigneeView[];
  viewerId: string;
  onOpenItem: (item: Item) => void;
  /** Each sub-item's assignees as last set here (see useOptimisticAssignees). */
  assigneesById: Record<string, string[]>;
  onAssign: (id: string, assigneeIds: string[]) => void;
  /** The sub-item whose assignee picker is open, if any (owned by the dialog,
   * which hands its A/I shortcuts over while one is open). */
  pickerFor: string | null;
  onPickerFor: (id: string | null) => void;
  /** The sub-item just gone back from, focused as the checklist shows. */
  focusId: string | null;
}) {
  const [draft, setDraft] = useState("");
  const { setCompleted } = useItemChanges();
  // Adds run one after another, so lines typed quickly land in typed order.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  // Lines still saving: each shows at once, faded, until the refreshed
  // checklist has it (it has no ref or controls until then).
  type Adding = { key: number; title: string; known: string[] };
  const [addingAll, showAdding] = useOptimistic<Adding[], Adding>([], (cur, line) => [
    ...cur,
    line,
  ]);
  // A line stops showing as saving once a sub-item with its title appears that
  // wasn't there when it was typed, so it never shows twice. Each new sub-item
  // stands for one line, so two lines with the same title wait for two.
  const claimed = new Set<string>();
  const adding = addingAll.filter((a) => {
    const saved = items.find(
      (i) => !claimed.has(i.id) && i.title === a.title && !a.known.includes(i.id),
    );
    if (saved) claimed.add(saved.id);
    return !saved;
  });
  const nextKey = useRef(0);
  const rows = items.length + adding.length;
  // Each new row lands above the input and pushes it down, out of view once
  // the dialog hits its max height. Nothing else scrolls it back (the
  // drawer's keyboard provider only aligns on focus), so do it while typing.
  const input = useRef<HTMLInputElement>(null);
  const count = useRef(rows);
  useLayoutEffect(() => {
    const grew = rows > count.current;
    count.current = rows;
    if (grew && input.current === document.activeElement) {
      input.current?.scrollIntoView({ block: "nearest" });
    }
  }, [rows]);

  function add() {
    const title = draft.trim();
    if (!title) return;
    setDraft("");
    const save = queue.current.then(async () => {
      const added = await runAction(
        addItemAction({ projectId: parent.projectId, title, parentId: parent.id }),
        `add “${title}”`,
      );
      // Put a failed line back, unless another is already being typed.
      if (!added) setDraft((cur) => cur || title);
    });
    queue.current = save;
    startTransition(async () => {
      showAdding({ key: nextKey.current++, title, known: items.map((i) => i.id) });
      await save;
    });
  }

  return (
    <div className="space-y-1">
      {items.map((child) => {
        const done = child.completedAt !== null;
        const childAssigneeIds = assigneesById[child.id] ?? child.assigneeIds;
        const assigned = assignees.filter((a) => childAssigneeIds.includes(a.userId));
        return (
          <div
            key={child.id}
            data-item-ref={formatItemRef(prefix, child.number)}
            className="flex items-center gap-2 px-1 py-0.5"
          >
            <Checkbox
              checked={done}
              onCheckedChange={() => setCompleted(child, !done)}
              aria-label={`${done ? "Uncomplete" : "Complete"} ${child.title}`}
            />
            <button
              type="button"
              autoFocus={child.id === focusId}
              onClick={() => onOpenItem(child)}
              className={`min-w-0 flex-1 truncate text-left text-sm hover:underline ${
                done ? "text-neutral-400 line-through" : ""
              }`}
            >
              {child.title}
            </button>
            <DropdownMenu
              open={pickerFor === child.id}
              onOpenChange={(o) => onPickerFor(o ? child.id : null)}
            >
              <DropdownMenuTrigger
                aria-label={
                  assigned.length
                    ? `${child.title}: assigned to ${assigneeNames(assigned)}. Change assignees`
                    : `Assign ${child.title}`
                }
                className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full touch:h-8 touch:min-w-8 text-neutral-300 transition hover:bg-neutral-100 hover:text-neutral-600 dark:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
              >
                {assigned.length ? (
                  <AvatarStack users={assigned} size={18} ringClassName="ring-popover" />
                ) : (
                  <UserRound className="size-4" />
                )}
              </DropdownMenuTrigger>
              <DropdownMenuContent data-assignee-picker align="end" className="w-52">
                <AssigneeOptions
                  selected={childAssigneeIds}
                  assignees={assignees}
                  viewerId={viewerId}
                  onChange={(assigneeIds) => onAssign(child.id, assigneeIds)}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      })}
      {adding.map(({ key, title }) => (
        <div
          key={`adding-${key}`}
          aria-busy
          className="flex items-center gap-2 px-1 py-0.5 text-sm text-neutral-400"
        >
          <span aria-hidden="true" className="size-4 shrink-0 rounded-full border border-dashed border-current" />
          <span className="min-w-0 flex-1 truncate">{title}</span>
        </div>
      ))}
      <Input
        ref={input}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            add();
          }
        }}
        placeholder={rows ? "Add another…" : "Add a step…"}
        className="scroll-mb-4"
        // Not the task's title: Safari reads the label to guess the field,
        // so a task like "Change phone plan" got phone-number AutoFill (it
        // ignores autocomplete="off"). The dialog is already titled.
        aria-label="Add a sub-item"
      />
    </div>
  );
}
type ItemDetailProps = {
  item: Item;
  /** For a sub-item, the task it belongs to. */
  parent: Item | null;
  /** This item's sub-items, in order. */
  checklist: Item[];
  /** Tasks this item can become a sub-item of: the list's other open
   * top-level tasks, in order. */
  nestTargets: Item[];
  /** Switch to another item (a sub-item or the parent). */
  onOpenItem: (item: Item) => void;
  prefix: string;
  assignees: AssigneeView[];
  viewerId: string;
  prLinks: ItemPrLink[];
  open: boolean;
  /** The sub-item just gone back from, to focus its checklist line. */
  cameFrom?: string | null;
};

/**
 * An item's details in a dialog of their own. Going to a sub-item or the
 * parent slides the new one in, with a way back to the one before
 * (useItemDetailDialog's history).
 */
export function ItemDetailDialog({
  onOpenChange,
  history,
  ...props
}: ItemDetailProps & {
  onOpenChange: (open: boolean) => void;
  /** Where it's been, to go back; absent, there's no way back. */
  history?: ItemHistory;
}) {
  return (
    <ResponsiveDialog open={props.open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogViews view={props.item.id} direction={history?.direction ?? "forward"}>
          <ItemDetailView
            {...props}
            cameFrom={history?.direction === "back" ? history.left : null}
            onClose={() => onOpenChange(false)}
            back={
              history?.previous && (
                <ResponsiveDialogBackButton label={history.previous.title} onClick={history.onBack} />
              )
            }
          />
        </ResponsiveDialogViews>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

/**
 * An item's details: a header, a scrolling body and a footer, for a dialog
 * of its own (ItemDetailDialog) or as one view of another dialog
 * (ResponsiveDialogViews), with `back` at the start of its header.
 */
export function ItemDetailView({
  item,
  parent,
  checklist,
  nestTargets,
  onOpenItem,
  prefix,
  assignees,
  viewerId,
  prLinks,
  open,
  cameFrom = null,
  onClose,
  back,
}: ItemDetailProps & {
  /** Leave the item, as deleting or moving it does. */
  onClose: () => void;
  /** A way back to the view it was opened from. */
  back?: React.ReactNode;
}) {
  const [pending, start] = useTransition();
  const { agentOptions, setAgent } = useAgentAssignment(item, start);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  // A sub-item's assignee picker in the checklist, when one is open.
  const [childPickerFor, setChildPickerFor] = useState<string | null>(null);
  const completed = item.completedAt !== null;
  const ref = formatItemRef(prefix, item.number);
  const { assigneesById, setAssignees } = useOptimisticAssignees([item, ...checklist]);
  const assigneeIds = assigneesById[item.id];
  const assigned = assignees.filter((a) => assigneeIds.includes(a.userId));
  // The item's labels ahead of the server (rule 3), with the emoji shown for
  // new ones until the list has them.
  const [labels, showLabels] = useOptimistic(item.labels);
  const [newLabelEmoji, setNewLabelEmoji] = useState<Record<string, LabelEmoji>>({});
  // Switching to another item (a sub-item or the parent) drops the last one's.
  const [labelsFor, setLabelsFor] = useState(item.id);
  if (labelsFor !== item.id) {
    setLabelsFor(item.id);
    setNewLabelEmoji({});
  }
  const [, startLabels] = useTransition();
  function setLabels(names: string[], added?: { name: string; emoji?: LabelEmoji }) {
    const emoji = added?.emoji;
    if (added && emoji) setNewLabelEmoji((cur) => ({ ...cur, [added.name]: emoji }));
    startLabels(async () => {
      showLabels(names);
      await runAction(
        updateItemAction(item.id, {
          labels: names,
          labelEmoji: added && emoji ? { [added.name]: emoji } : undefined,
        }),
        `change the labels of “${item.title}”`,
      );
    });
  }
  const canAssignSelf = useMemo(
    () => assignees.some((a) => a.userId === viewerId),
    [assignees, viewerId],
  );

  const assign = useCallback(
    (ids: string[]) => setAssignees(item.id, ids),
    [setAssignees, item.id],
  );
  const openPicker = useCallback(() => setAssignOpen(true), []);
  // I adds you, or takes you off if you're already on it, leaving anyone else.
  const toggleMe = useCallback(() => {
    assign(toggleAssignee(assigneeIds, viewerId));
    setAssignOpen(false);
  }, [assign, assigneeIds, viewerId]);

  // While the dialog is open, ⌘./Ctrl+. copies the ref (Linear's shortcut).
  const { copied, copy } = useCopyItemRef(ref, { active: open });
  const follows = useFollows();
  const following = follows?.isFollowing(item.id) ?? false;

  // Linear's assignment shortcuts while the dialog owns the screen: A opens the
  // picker, I adds or removes me. Stays armed while the picker is open so the I
  // hint shown on the "me" row works there (useItemShortcuts listens ahead of
  // the menu's typeahead). No deferToDialog: this is the dialog
  // the shortcuts defer to, so it should respond.
  // While a sub-item's picker is open, I toggles me on that sub-item (as its
  // menu's hint says) and A does nothing, rather than both acting on this item.
  const toggleMeOnChild = useCallback(() => {
    if (!childPickerFor) return;
    setAssignees(
      childPickerFor,
      toggleAssignee(assigneesById[childPickerFor] ?? [], viewerId),
    );
    setChildPickerFor(null);
  }, [assigneesById, setAssignees, childPickerFor, viewerId]);
  const noop = useCallback(() => {}, []);
  // D opens the due date, X ticks the item, ⌫ deletes it (asking first).
  const [dueOpen, setDueOpen] = useState(false);
  useItemShortcuts({
    active: open && childPickerFor === null && !dueOpen,
    onOpenPicker: openPicker,
    onAssignToMe: canAssignSelf ? toggleMe : undefined,
    onDue: () => !pending && setDueOpen(true),
    onToggleDone: () => toggle(),
    onDelete: () => del(),
  });
  useItemShortcuts({
    active: open && childPickerFor !== null,
    onOpenPicker: noop,
    onAssignToMe: canAssignSelf ? toggleMeOnChild : undefined,
  });

  // On closing, however it closes: reset the picker so a closed dialog never
  // reopens with it already open (which would also disarm the A/I shortcuts).
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) {
      setConfirmingDelete(false);
      setAssignOpen(false);
      setDueOpen(false);
      setChildPickerFor(null);
    }
  }

  const changes = useItemChanges();
  const move = useMoveItem();
  const selection = useContext(SelectedItemContext);
  function toggle() {
    changes.setCompleted(item, !completed);
  }

  function del() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    // Deleting the item the board's keys selected moves the selection on.
    if (selection?.selectedId === item.id) selection.select(rowAfterDelete(item.id));
    changes.deleteItem(item);
    onClose();
  }

  return (
    <>
    <div className="flex shrink-0 flex-col gap-2 border-b border-neutral-200 px-4 pt-3 pb-4 dark:border-neutral-800">
      <div className="flex min-w-0 items-center gap-1">
        {back}
        <button
          type="button"
          onClick={() => void copy()}
          title={`Copy ID (${modifierSymbol()}.)`}
          className={`${back ? "" : "-ml-1.5 "}inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px] tracking-wide touch:py-1.5 touch:text-xs text-neutral-500 transition hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800`}
        >
          {copied ? (
            <Check className="size-3 opacity-70" />
          ) : (
            <Copy className="size-3 opacity-70" />
          )}
          {copied ? "Copied" : ref}
        </button>
        {follows && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-pressed={following}
            aria-label={following ? "Unfollow" : "Follow"}
            title={following ? "Unfollow" : "Follow: get notified of changes"}
            onClick={() => follows.setFollowing(item, !following)}
            className="ml-auto text-neutral-500"
          >
            {/* Filled while you follow it, like a pressed toggle. */}
            <Bell className={following ? "fill-current text-foreground" : ""} />
          </Button>
        )}
        <ResponsiveDialogCloseButton className={follows ? "" : "ml-auto"} />
      </div>
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          aria-pressed={completed}
          aria-label={completed ? "Completed" : "Complete"}
          title={completed ? "Mark as not done (X)" : "Complete (X)"}
          className={`mt-px shrink-0 rounded-full transition disabled:opacity-50 ${
            completed
              ? "text-green-600 hover:text-green-700 dark:text-green-500"
              : "text-neutral-400 hover:text-green-600 dark:text-neutral-500 dark:hover:text-green-500"
          }`}
        >
          {completed ? <CheckCircle2 className="size-6" /> : <Circle className="size-6" />}
        </button>
        <ResponsiveDialogTitle className="min-w-0 flex-1">
          <EditableText
            value={item.title}
            onSave={(next) =>
              runAction(updateItemAction(item.id, { title: next }), `rename “${item.title}”`)
            }
            required
            className={`block w-full break-words text-base leading-6 font-medium ${
              completed ? "text-neutral-400 line-through" : ""
            }`}
            inputClassName="w-full text-base"
            renderValue={(title) => <InlineCode>{title}</InlineCode>}
          />
        </ResponsiveDialogTitle>
      </div>
      <ResponsiveDialogDescription className="sr-only">
        Item details for {item.title}
      </ResponsiveDialogDescription>
      <div className="space-y-3 pl-8">
        <EditableText
          value={item.description ?? ""}
          onSave={(next) =>
            runAction(
              updateItemAction(item.id, { description: next || null }),
              `save the description of “${item.title}”`,
            )
          }
          multiline
          placeholder="Add description…"
          className="block w-full break-words text-sm text-neutral-600 dark:text-neutral-300"
          inputClassName="w-full text-sm"
          renderValue={(description) => <Markdown>{description}</Markdown>}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <DueChip
            open={dueOpen}
            setOpen={setDueOpen}
            item={item}
            done={completed}
            disabled={pending}
            onChange={(due) =>
              start(async () => {
                await runAction(
                  updateItemAction(item.id, due ?? { dueDate: null }),
                  `change the due date of “${item.title}”`,
                );
              })
            }
          />
          <RepeatChip
            item={item}
            disabled={pending}
            onChange={(repeat) =>
              start(async () => {
                await runAction(
                  updateItemAction(item.id, { repeat }),
                  `change how “${item.title}” repeats`,
                );
              })
            }
          />
          <DropdownMenu open={assignOpen} onOpenChange={setAssignOpen}>
            <DropdownMenuTrigger
              aria-disabled={pending || undefined}
              title="Assignees (A)"
              className={assigned.length ? CHIP : EMPTY_CHIP}
            >
              {assigned.length ? (
                <>
                  <AvatarStack users={assigned} size={18} ringClassName="ring-popover" />
                  <span className="truncate">{assigneeNames(assigned)}</span>
                </>
              ) : (
                <>
                  <UserRound />
                  <span data-replay-safe>Unassigned</span>
                </>
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent data-assignee-picker align="start" className="w-56">
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
          {/* Not for an item in an archived list, which isn't a move target. */}
          {move?.groups.some((g) => g.lists.some((l) => l.id === item.projectId)) && (
            <MoveToListPicker
              item={item}
              disabled={pending}
              className={CHIP}
              onPick={(projectId) => {
                // The item leaves this list, so the sheet takes over.
                onClose();
                move?.open(item, projectId);
              }}
            />
          )}
          <LabelChips
            key={item.id}
            projectId={item.projectId}
            value={labels}
            onChange={setLabels}
            draftEmoji={newLabelEmoji}
            chipClassName={labels.length ? `${EMPTY_CHIP} px-2` : EMPTY_CHIP}
          />
          {parent ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-disabled={pending || undefined}
                title="Sub-item of"
                data-item-ref={formatItemRef(prefix, parent.number)}
                className={CHIP}
              >
                <IndentIncrease />
                <span className="max-w-48 truncate">{parent.title}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuItem onClick={() => onOpenItem(parent)}>
                  <CornerLeftUp />
                  Open parent
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => changes.setParent(item, null)}>
                  <IndentDecrease />
                  Move out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            // The touch way to nest an existing task, where there's no
            // row menu: an item with sub-items can't become one.
            checklist.length === 0 &&
            nestTargets.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-disabled={pending || undefined}
                  aria-label="Make it a sub-item of…"
                  className={EMPTY_CHIP}
                >
                  <IndentIncrease />
                  <span data-replay-safe>Parent</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                  {nestTargets.map((t) => (
                    <DropdownMenuItem
                      key={t.id}
                      data-item-ref={formatItemRef(prefix, t.number)}
                      onClick={() => changes.setParent(item, t.id)}
                    >
                      <span className="truncate">{t.title}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )
          )}
        </div>
      </div>
    </div>

    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4">
      <AgentWork item={item} assignees={assignees} />

      {!parent && (
        <Field
          label={
            checklist.length
              ? `Checklist · ${checklist.filter((c) => c.completedAt !== null).length}/${checklist.length}`
              : "Checklist"
          }
        >
          <Checklist
            parent={item}
            prefix={prefix}
            items={checklist}
            assignees={assignees}
            viewerId={viewerId}
            onOpenItem={(child) => {
              setChildPickerFor(null);
              onOpenItem(child);
            }}
            assigneesById={assigneesById}
            onAssign={setAssignees}
            pickerFor={childPickerFor}
            onPickerFor={setChildPickerFor}
            focusId={cameFrom}
          />
        </Field>
      )}

      {prLinks.length > 0 && (
        <Field label="Pull requests">
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {prLinks.map((link) => (
              <PrLink key={link.id} url={link.prUrl} state={link.prState} className="text-sm" />
            ))}
          </div>
        </Field>
      )}

      <Field label="Comments">
        <ItemComments key={item.id} item={item} viewerId={viewerId} people={assignees} />
      </Field>

      <ItemActivity item={item} />
    </div>

    <div className="flex shrink-0 items-center justify-between border-t border-neutral-200 px-4 py-2.5 dark:border-neutral-800">
      <span data-replay-safe className="text-xs text-neutral-400">
        {completed && item.completedAt
          ? `Completed ${dayLabel(item.completedAt)}`
          : `Created ${dayLabel(item.createdAt)}`}
      </span>
      <Button
        variant={confirmingDelete ? "destructive" : "ghost"}
        size="sm"
        data-replay-safe
        onClick={del}
        disabled={pending}
        className={confirmingDelete ? "" : "text-neutral-500 hover:text-destructive"}
      >
        <Trash2 />
        {confirmingDelete ? "Confirm delete?" : "Delete"}
        {!confirmingDelete && <Kbd className="ml-0.5">⌫</Kbd>}
      </Button>
    </div>
    </>
  );
}
