"use client";

import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
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
import { unstable_rethrow } from "next/navigation";
import {
  useCallback,
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
import { repeatOf } from "@/lib/repeat";
import { dayLabel, formatRelative } from "@/lib/time";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import {
  ResponsiveDialog,
  ResponsiveDialogCloseButton,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { AssigneeOptions } from "./AssigneeOptions";
import { AuditEntryRow } from "./AuditDialog";
import { DueDatePicker } from "./DueDatePicker";
import { PrLink } from "./PrLink";
import { RepeatPicker } from "./RepeatPicker";
import { runAction } from "./run-action";
import { EditableText } from "./EditableText";
import { ItemComments } from "./ItemComments";
import { LabelsField } from "./Labels";
import { MoveToListPicker, useMoveItem } from "./MoveItem";
import { InlineCode, Markdown } from "./Markdown";
import { useAssignShortcuts } from "./useAssignShortcuts";
import { useOptimisticAssignees } from "./use-optimistic-assignees";
import { useItemChanges } from "./use-optimistic-items";
import { useCopyItemRef } from "./useCopyItemRef";
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
        className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-neutral-400 transition touch:-my-2 touch:py-2 touch:pr-4 hover:text-neutral-600 dark:hover:text-neutral-300"
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
          <div key={child.id} className="flex items-center gap-2 px-1 py-0.5">
            <Checkbox
              checked={done}
              onCheckedChange={() => setCompleted(child, !done)}
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

  const changes = useItemChanges();
  const move = useMoveItem();
  function toggle() {
    changes.setCompleted(item, !completed);
  }

  function del() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    changes.deleteItem(item);
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
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px] tracking-wide touch:py-1.5 touch:text-xs text-neutral-500 transition hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
            >
              {copied ? (
                <Check className="size-3 opacity-70" />
              ) : (
                <Copy className="size-3 opacity-70" />
              )}
              {copied ? "Copied" : ref}
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
              onSave={(next) =>
                runAction(updateItemAction(item.id, { title: next }), `rename “${item.title}”`)
              }
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
          </Field>

          <Field label="Labels">
            <LabelsField
              key={item.id}
              projectId={item.projectId}
              value={labels}
              onChange={setLabels}
              draftEmoji={newLabelEmoji}
            />
          </Field>

          <AgentWork item={item} assignees={assignees} />

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
                  agents={agentOptions}
                  onAgentChange={setAgent}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          </Field>

          {/* Not for an item in an archived list, which isn't a move target. */}
          {move?.groups.some((g) => g.lists.some((l) => l.id === item.projectId)) && (
            <Field label="List">
              <MoveToListPicker
                item={item}
                disabled={pending}
                onPick={(projectId) => {
                  // The item leaves this list, so the sheet takes over.
                  change(false);
                  move?.open(item, projectId);
                }}
              />
            </Field>
          )}

          <Field label="Due">
            <DueDatePicker
              key={item.id}
              due={item.dueDate ? { dueDate: item.dueDate, dueFrom: item.dueFrom } : null}
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
          </Field>

          <Field label="Repeat">
            <RepeatPicker
              key={item.id}
              repeat={repeatOf(item)}
              completedAt={item.completedAt}
              due={item}
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
                    changes.setParent(item, null)
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
                            changes.setParent(item, t.id)
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
