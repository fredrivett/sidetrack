"use client";

import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Circle,
  CircleDashed,
  Copy,
  ExternalLink,
  GitBranch,
  IndentDecrease,
  IndentIncrease,
  Trash2,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  addItemAction,
  completeItemAction,
  deleteItemAction,
  setItemParentAction,
  uncompleteItemAction,
  updateItemAction,
} from "@/app/actions";
import type { AssigneeView } from "@/core/members";
import type { Item, ItemPrLink } from "@/core/schema";
import { toggleAssignee } from "@/lib/assignees";
import { formatItemRef, workBranchName } from "@/lib/itemRef";
import { modifierSymbol } from "@/lib/keyboard";
import { prLabel } from "@/lib/pr";
import { repeatOf } from "@/lib/repeat";
import {
  dayLabel,
  formatRelative,
  localDate,
  localDay,
  parseDueDay,
  quickDueDays,
} from "@/lib/time";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ResponsiveDialog,
  ResponsiveDialogCloseButton,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { AssigneeOptions } from "./AssigneeOptions";
import { CategoryBadge } from "./CategoryBadge";
import { DueBadge } from "./DueBadge";
import { RepeatPicker } from "./RepeatPicker";
import { useToday } from "./use-day-start";
import { EditableText } from "./EditableText";
import { InlineCode, Markdown } from "./Markdown";
import { useAssignShortcuts } from "./useAssignShortcuts";
import { useOptimisticAssignees } from "./use-optimistic-assignees";
import { useCopyItemRef } from "./useCopyItemRef";
import { AgentAvatar, AvatarStack, assigneeName, assigneeNames } from "./UserAvatar";
import { useItemAgentSessions } from "./agent-sessions";

/**
 * The agents working on the item, each with its status, latest note, thread
 * and branch; or, once none are, a line for the last one that finished.
 */
function AgentWork({
  item,
  prefix,
  assignees,
}: {
  item: Item;
  prefix: string;
  assignees: AssigneeView[];
}) {
  const { sessions, agents } = useItemAgentSessions(item.id);
  // start_work names branches from the bare ref, never owner-qualified.
  const ref = formatItemRef(prefix.split("/").pop() ?? prefix, item.number);
  if (agents.length === 0) {
    const last = sessions.findLast((s) => s.finishedAt !== null);
    if (!last?.finishedAt) return null;
    return (
      <Field label="Agent">
        <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-500">
          <AgentAvatar agent={{ id: last.id, name: last.agentName }} size={18} />
          <span className="min-w-0 break-words">
            {last.agentName} finished {formatRelative(last.finishedAt)}
            {last.note ? `: ${last.note}` : ""}
          </span>
          {last.threadUrl && <ThreadLink url={last.threadUrl}>Thread</ThreadLink>}
        </div>
      </Field>
    );
  }
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
                <span className="inline-flex min-w-0 items-center gap-1 text-neutral-500">
                  <GitBranch className="size-3 shrink-0" />
                  <span className="truncate font-mono">{workBranchName(ref, item.title)}</span>
                </span>
              </div>
              <p className="text-xs text-neutral-400">
                Started {formatRelative(s.startedAt)}
                {owner ? `, for ${assigneeName(owner)}` : ""}
              </p>
            </div>
          );
        })}
      </div>
    </Field>
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
      <span className="block text-[11px] font-medium uppercase tracking-wide text-neutral-400">
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * A task's sub-items, each ticked off in place, with an input that stays
 * focused after Enter so a whole checklist goes in one line after another.
 */
function Checklist({
  parent,
  items,
  assignees,
  viewerId,
  onOpenItem,
  assigneesById,
  onAssign,
  pickerFor,
  onPickerFor,
}: {
  parent: Item;
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
}) {
  const [draft, setDraft] = useState("");
  // Checkboxes wait for the last toggle to land, so a quick second click
  // doesn't repeat it from the stale state.
  const [pending, start] = useTransition();
  // Adds run one after another, so lines typed quickly land in typed order.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  // Each new row lands above the input and pushes it down, out of view once
  // the dialog hits its max height. Nothing else scrolls it back (the
  // drawer's keyboard provider only aligns on focus), so do it while typing.
  const input = useRef<HTMLInputElement>(null);
  const count = useRef(items.length);
  useLayoutEffect(() => {
    const grew = items.length > count.current;
    count.current = items.length;
    if (grew && input.current === document.activeElement) {
      input.current?.scrollIntoView({ block: "nearest" });
    }
  }, [items.length]);

  function add() {
    const title = draft.trim();
    if (!title) return;
    setDraft("");
    queue.current = queue.current
      .then(() =>
        addItemAction({
          projectId: parent.projectId,
          title,
          parentId: parent.id,
        }),
      )
      .catch(() => toast.error(`Couldn't add “${title}”. Please try again.`));
  }

  return (
    <div className="space-y-1">
      {items.map((child) => {
        const done = child.completedAt !== null;
        const childAssigneeIds = assigneesById[child.id] ?? child.assigneeIds;
        const assigned = assignees.filter((a) => childAssigneeIds.includes(a.userId));
        return (
          <div key={child.id} className="flex items-center gap-2 px-1 py-0.5">
            <Checkbox
              checked={done}
              disabled={pending}
              onCheckedChange={() =>
                start(() => {
                  void (done
                    ? uncompleteItemAction(child.id)
                    : completeItemAction(child.id));
                })
              }
              aria-label={`${done ? "Uncomplete" : "Complete"} ${child.title}`}
            />
            <button
              type="button"
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
                className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full text-neutral-300 transition hover:bg-neutral-100 hover:text-neutral-600 dark:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
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
        placeholder={items.length ? "Add another…" : "Add a step…"}
        className="scroll-mb-4"
        // Not the task's title: Safari reads the label to guess the field,
        // so a task like "Change phone plan" got phone-number AutoFill (it
        // ignores autocomplete="off"). The dialog is already titled.
        aria-label="Add a sub-item"
      />
    </div>
  );
}

/**
 * A popover for any day the quick buttons don't offer: type one ("fri",
 * "in 2 weeks") and press Enter, or click it on the calendar, which follows
 * what's typed. `today` is the app's day (with its 4am turnover), so the
 * calendar marks the same day the Today button sets. Weeks start on Monday,
 * as "Next week" does.
 */
function DueCalendar({
  due,
  today,
  disabled,
  onChange,
}: {
  due: string | null;
  today: string | null;
  disabled: boolean;
  onChange: (due: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [month, setMonth] = useState<Date>();
  const input = useRef<HTMLInputElement>(null);
  const typed = text.trim() && today ? parseDueDay(text, today) : null;
  const shown = typed ?? due;

  function openChange(next: boolean) {
    setOpen(next);
    setText("");
    const day = due ?? today;
    setMonth(day ? localDate(day) : undefined);
  }

  function pick(day: string) {
    setOpen(false);
    if (day !== due) onChange(day);
  }

  return (
    <Popover open={open} onOpenChange={openChange}>
      <PopoverTrigger
        render={
          <Button type="button" variant="outline" size="xs" disabled={disabled} />
        }
      >
        <CalendarDays />
        Pick date
      </PopoverTrigger>
      <PopoverContent align="start" initialFocus={input} className="w-auto p-0">
        <div className="space-y-1.5 px-2 pt-2 contain-inline-size">
          <Input
            ref={input}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              const day = today && parseDueDay(e.target.value, today);
              if (day) setMonth(localDate(day));
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing && typed) {
                e.preventDefault();
                pick(typed);
              }
            }}
            placeholder="fri, in 2 weeks, 27 nov…"
            aria-label="Type a due date"
            className="h-7"
          />
          {text.trim() && (
            <p
              aria-live="polite"
              className="flex h-5 items-center justify-between px-1 text-xs text-muted-foreground"
            >
              {typed ? (
                <>
                  <span className="text-foreground">
                    {localDate(typed).toLocaleDateString(undefined, {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                      year:
                        typed.slice(0, 4) === today?.slice(0, 4) ? undefined : "numeric",
                    })}
                  </span>
                  <Kbd>↵</Kbd>
                </>
              ) : (
                "Not a date"
              )}
            </p>
          )}
        </div>
        <Calendar
          mode="single"
          required
          selected={shown ? localDate(shown) : undefined}
          month={month}
          onMonthChange={setMonth}
          today={today ? localDate(today) : undefined}
          weekStartsOn={1}
          onSelect={(date) => pick(localDay(date))}
        />
      </PopoverContent>
    </Popover>
  );
}

/** Quick due-date buttons, a date picker for anything else, and Clear. */
function DueDatePicker({
  due,
  done,
  disabled,
  onChange,
}: {
  due: string | null;
  done: boolean;
  disabled: boolean;
  onChange: (due: string | null) => void;
}) {
  const today = useToday();
  const quick = today ? quickDueDays(today) : [];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {/* A pressed quick button already says when it's due. */}
      {due && !quick.some(([, day]) => day === due) && (
        <DueBadge due={due} done={done} />
      )}
      {quick.map(([label, day]) => (
        <Button
          key={label}
          type="button"
          variant="outline"
          size="xs"
          disabled={disabled}
          aria-pressed={due === day}
          onClick={() => onChange(day)}
          className={
            due === day
              ? "border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-800 hover:text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
              : ""
          }
        >
          {label}
        </Button>
      ))}
      <DueCalendar due={due} today={today} disabled={disabled} onChange={onChange} />
      {due && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={disabled}
          onClick={() => onChange(null)}
        >
          Clear
        </Button>
      )}
    </div>
  );
}

export function ItemDetailDialog({
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
  onOpenChange,
}: {
  item: Item;
  /** For a sub-item, the task it belongs to. */
  parent: Item | null;
  /** This item's sub-items, in order. */
  checklist: Item[];
  /** Tasks this item can become a sub-item of: the list's other open
   * top-level tasks, in order. */
  nestTargets: Item[];
  /** Switch the dialog to another item (a sub-item or the parent). */
  onOpenItem: (item: Item) => void;
  prefix: string;
  assignees: AssigneeView[];
  viewerId: string;
  prLinks: ItemPrLink[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [pending, start] = useTransition();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  // A sub-item's assignee picker in the checklist, when one is open.
  const [childPickerFor, setChildPickerFor] = useState<string | null>(null);
  const completed = item.completedAt !== null;
  const ref = formatItemRef(prefix, item.number);
  const { assigneesById, setAssignees } = useOptimisticAssignees([item, ...checklist]);
  const assigneeIds = assigneesById[item.id];
  const assigned = assignees.filter((a) => assigneeIds.includes(a.userId));
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
  const { copy } = useCopyItemRef(ref, { active: open });

  // Linear's assignment shortcuts while the dialog owns the screen: A opens the
  // picker, I adds or removes me. Stays armed while the picker is open so the I
  // hint shown on the "me" row works there (useAssignShortcuts listens ahead of
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
  useAssignShortcuts({
    active: open && childPickerFor === null,
    onOpenPicker: openPicker,
    onAssignToMe: canAssignSelf ? toggleMe : undefined,
  });
  useAssignShortcuts({
    active: open && childPickerFor !== null,
    onOpenPicker: noop,
    onAssignToMe: canAssignSelf ? toggleMeOnChild : undefined,
  });

  function change(next: boolean) {
    if (!next) {
      setConfirmingDelete(false);
      // Reset the picker so a closed dialog never reopens with it already open
      // (which would also disarm the A/I shortcuts).
      setAssignOpen(false);
      setChildPickerFor(null);
    }
    onOpenChange(next);
  }

  function toggle() {
    start(() => {
      void (completed
        ? uncompleteItemAction(item.id)
        : completeItemAction(item.id));
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
    change(false);
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={change}>
      <ResponsiveDialogContent>
        <div className="flex shrink-0 flex-col gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void copy()}
              title="Copy ID"
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px] tracking-wide text-neutral-500 transition hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
            >
              <Copy className="size-3 opacity-70" />
              {ref}
              <Kbd className="ml-0.5">{modifierSymbol()}.</Kbd>
            </button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={toggle}
              disabled={pending}
              aria-pressed={completed}
              className={`ml-auto ${
                completed
                  ? "border-green-600/30 bg-green-50 text-green-700 hover:bg-green-100 dark:border-green-500/30 dark:bg-green-950/40 dark:text-green-400 dark:hover:bg-green-950/70"
                  : ""
              }`}
            >
              {completed ? <CheckCircle2 /> : <Circle />}
              {completed ? "Completed" : "Complete"}
            </Button>
            <ResponsiveDialogCloseButton />
          </div>
          <ResponsiveDialogTitle>
            <EditableText
              value={item.title}
              onSave={(next) => updateItemAction(item.id, { title: next })}
              required
              className={`block w-full break-words text-base font-medium ${
                completed ? "text-neutral-400 line-through" : ""
              }`}
              inputClassName="w-full text-base"
              renderValue={(title) => <InlineCode>{title}</InlineCode>}
            />
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="sr-only">
            Item details for {item.title}
          </ResponsiveDialogDescription>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4">
          <Field label="Description">
            <EditableText
              value={item.description ?? ""}
              onSave={(next) =>
                updateItemAction(item.id, { description: next || null })
              }
              multiline
              placeholder="Add description…"
              className="block w-full break-words text-sm text-neutral-600 dark:text-neutral-300"
              inputClassName="w-full text-sm"
              renderValue={(description) => <Markdown>{description}</Markdown>}
            />
          </Field>

          <Field label="Category">
            <EditableText
              value={item.category ?? ""}
              onSave={(next) =>
                updateItemAction(item.id, { category: next || null })
              }
              placeholder="Add category…"
              className="block w-full break-words text-sm text-neutral-600 dark:text-neutral-300"
              inputClassName="w-full text-sm"
              renderValue={(category) => <CategoryBadge category={category} />}
            />
          </Field>

          <AgentWork item={item} prefix={prefix} assignees={assignees} />

          <Field label="Assignees">
            <DropdownMenu open={assignOpen} onOpenChange={setAssignOpen}>
              <DropdownMenuTrigger
                disabled={pending}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-neutral-100 disabled:opacity-50 dark:hover:bg-neutral-800"
              >
                {assigned.length ? (
                  <>
                    <AvatarStack users={assigned} size={20} ringClassName="ring-popover" />
                    <span className="truncate text-neutral-700 dark:text-neutral-200">
                      {assigneeNames(assigned)}
                    </span>
                  </>
                ) : (
                  <>
                    <CircleDashed className="size-5 text-neutral-400" />
                    <span className="text-neutral-500">Unassigned</span>
                  </>
                )}
                <Kbd className="ml-auto">A</Kbd>
                <ChevronDown className="size-4 opacity-50" />
              </DropdownMenuTrigger>
              <DropdownMenuContent data-assignee-picker align="start" className="w-56">
                <AssigneeOptions
                  selected={assigneeIds}
                  assignees={assignees}
                  viewerId={viewerId}
                  onChange={assign}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          </Field>

          <Field label="Due">
            <DueDatePicker
              key={item.id}
              due={item.dueDate}
              done={completed}
              disabled={pending}
              onChange={(dueDate) =>
                start(() => {
                  void updateItemAction(item.id, { dueDate });
                })
              }
            />
          </Field>

          <Field label="Repeat">
            <RepeatPicker
              key={item.id}
              repeat={repeatOf(item)}
              completedAt={item.completedAt}
              disabled={pending}
              onChange={(repeat) =>
                start(() => {
                  void updateItemAction(item.id, { repeat });
                })
              }
            />
          </Field>

          {parent ? (
            <Field label="Sub-item of">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onOpenItem(parent)}
                  className="min-w-0 flex-1 truncate text-left text-sm text-neutral-700 hover:underline dark:text-neutral-200"
                >
                  {parent.title}
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    start(() => {
                      void setItemParentAction(item.id, null);
                    })
                  }
                >
                  <IndentDecrease />
                  Move out
                </Button>
              </div>
            </Field>
          ) : (
            <>
              {/* The touch way to nest an existing task, where there's no row
                  menu: an item with sub-items can't become one. */}
              {checklist.length === 0 && nestTargets.length > 0 && (
                <Field label="Sub-item of">
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      disabled={pending}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-neutral-100 disabled:opacity-50 dark:hover:bg-neutral-800"
                    >
                      <IndentIncrease className="size-4 text-neutral-400" />
                      <span className="text-neutral-500">
                        None — make it a sub-item of…
                      </span>
                      <ChevronDown className="ml-auto size-4 opacity-50" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-64">
                      {nestTargets.map((t) => (
                        <DropdownMenuItem
                          key={t.id}
                          onClick={() =>
                            start(() => {
                              void setItemParentAction(item.id, t.id);
                            })
                          }
                        >
                          <span className="truncate">{t.title}</span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </Field>
              )}
              <Field
                label={
                  checklist.length
                    ? `Checklist · ${checklist.filter((c) => c.completedAt !== null).length}/${checklist.length}`
                    : "Checklist"
                }
              >
                <Checklist
                  parent={item}
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
                />
              </Field>
            </>
          )}

          {prLinks.length > 0 && (
            <Field label="Pull requests">
              <div className="flex flex-wrap gap-1">
                {prLinks.map((link) => (
                  <a
                    key={link.id}
                    href={link.prUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-block rounded bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-950/70"
                  >
                    {prLabel(link.prUrl)}
                  </a>
                ))}
              </div>
            </Field>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <span className="text-xs text-neutral-400">
            {completed && item.completedAt
              ? `Completed ${dayLabel(item.completedAt)}`
              : `Created ${dayLabel(item.createdAt)}`}
          </span>
          <Button
            variant="destructive"
            size="sm"
            onClick={del}
            disabled={pending}
          >
            <Trash2 />
            {confirmingDelete ? "Confirm delete?" : "Delete"}
          </Button>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
