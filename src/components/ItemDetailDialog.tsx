"use client";

import {
  Bell,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  CircleX,
  Copy,
  CornerLeftUp,
  ExternalLink,
  Eye,
  MessageSquare,
  GitBranch,
  IndentDecrease,
  IndentIncrease,
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
import { getItemSourceAction, listAuditAction } from "@/app/actions";
import type { AuditEntryWithActor } from "@/core/audit";
import type { LabelEmoji } from "@/core/labels";
import type { AssigneeView } from "@/core/members";
import type { AgentSession, Item, ItemPrLink } from "@/core/schema";
import { toggleAssignee } from "@/lib/assignees";
import { useItemSaves } from "./item-saves";
import { formatItemRef } from "@/lib/itemRef";
import { modifierSymbol } from "@/lib/keyboard";
import { repeatOf } from "@/lib/repeat";
import { dayLabel, formatRelative } from "@/lib/time";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Fold } from "@/components/ui/fold";
import { Kbd } from "@/components/ui/kbd";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { PrLink } from "./PrLink";
import { SourcePhoto } from "./SourcePhoto";
import { runAction } from "./run-action";
import { EditableText } from "./EditableText";
import { useDraft } from "./use-draft";
import { ItemComments } from "./ItemComments";
import { LabelBadge, LabelChips, useListLabels } from "./Labels";
import { TitleField, useLineParts } from "./TitleField";
import { DueBadge, SomedayBadge, WaitingBadge } from "./DueBadge";
import { RepeatBadge } from "./RepeatBadge";
import { SmartDuePanel } from "./SmartDuePanel";
import { useListAccess } from "./list-access";
import { SortableChecklist } from "./ItemList";
import type { RowDrag } from "./ItemRow";
import { MoveToListPicker, useMoveItem } from "./MoveItem";
import { AssigneeChip, CHIP, DueChip, EMPTY_CHIP, Field, RepeatChip } from "./DialogFields";
import { InlineCode, Markdown } from "./Markdown";
import { rowAfterDelete, SelectedItemContext, useItemShortcuts } from "./useItemShortcuts";
import { useOptimisticAssignees } from "./use-optimistic-assignees";
import type { ItemHistory } from "./use-item-detail-dialog";
import { useItemChanges } from "./use-optimistic-items";
import { useCopyItemRef } from "./useCopyItemRef";
import { useFollows } from "./follows";
import { Struck } from "./Struck";
import { CancelItemDialog, CancelledChip } from "./CancelItem";
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
function ItemActivity({ item, viewerId, focus }: { item: Item; viewerId: string; focus: string | null }) {
  const canReact = useListAccess(item.projectId) !== "view";
  // Opened from a push about one of its rows: open, at that row.
  const [expanded, setExpanded] = useState(focus !== null);
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

  // Once it's loaded, bring that row into view, once.
  const scrolled = useRef(false);
  useEffect(() => {
    if (!focus || !entries || scrolled.current) return;
    scrolled.current = true;
    document.getElementById(`activity-${focus}`)?.scrollIntoView({ block: "center" });
  }, [focus, entries]);

  return (
    <div>
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
      <Fold open={expanded} loading={entries === null} className="space-y-1 pt-1">
        {entries === null ? (
          <p className="text-sm text-neutral-400">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-neutral-400">No activity yet.</p>
        ) : (
          <>
            <ul className="space-y-2.5">
              {entries.map((e) => (
                <AuditEntryRow
                  key={e.id}
                  entry={e}
                  react={{ viewerId, canReact, focused: e.id === focus }}
                />
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
        )}
      </Fold>
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
  readOnly = false,
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
  /** For those who can't change the list: ticks and assignees shown, not changed, and no new steps. */
  readOnly?: boolean;
}) {
  const { value: draft, set: setDraft } = useDraft(`item:${parent.id}:step`);
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

  // "@amy" in a line assigns her, "#errands" labels it, as in New item.
  const listLabels = useListLabels(parent.projectId);
  const line = useLineParts(
    draft,
    assignees.filter((a) => a.canEdit),
    listLabels.map((l) => l.name),
  );
  const saves = useItemSaves();
  function add() {
    const typed = draft.trim();
    if (!typed) return;
    const title = line.saved;
    const assigneeIds = line.assigneeIds;
    const labels = line.labels;
    setDraft("");
    line.reset();
    const save = queue.current.then(async () => {
      const added = await runAction(
        saves.addSubItem(parent.id, { title, assigneeIds, labels }),
        `add “${title}”`,
      );
      // Put a failed line back, unless another is already being typed.
      if (!added) setDraft((cur) => cur || typed);
    });
    queue.current = save;
    startTransition(async () => {
      showAdding({ key: nextKey.current++, title, known: items.map((i) => i.id) });
      await save;
    });
  }

  // A sub-item's line: the row that drags to reorder it, or (`lifted`) the
  // copy that follows the pointer.
  function step(child: Item, drag: RowDrag | undefined, lifted = false) {
    const done = child.completedAt !== null;
    const childAssigneeIds = assigneesById[child.id] ?? child.assigneeIds;
    const assigned = assignees.filter((a) => childAssigneeIds.includes(a.userId));
    return (
      <div
        {...drag?.attributes}
        {...drag?.listeners}
        ref={drag?.setActivatorNodeRef}
        aria-label={drag ? `Reorder ${child.title}` : undefined}
        data-item-ref={lifted ? undefined : formatItemRef(prefix, child.number)}
        className={`flex items-center gap-2 rounded-md px-1 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 ${
          drag ? "touch-manipulation" : ""
        } ${
          // While dragged, the line stays behind as the slot it would drop into.
          drag?.isDragging ? "bg-neutral-100 *:invisible dark:bg-neutral-800/50" : ""
        }`}
      >
        <Checkbox
          checked={done}
          cancelled={done && child.cancelled}
          onCheckedChange={() => setCompleted(child, !done)}
          readOnly={readOnly}
          aria-label={`${readOnly ? (done ? "Done:" : "Not done:") : done ? "Uncomplete" : "Complete"} ${child.title}`}
        />
        <button
          type="button"
          autoFocus={!lifted && child.id === focusId}
          onClick={() => onOpenItem(child)}
          className={`min-w-0 flex-1 truncate text-left text-sm hover:underline ${
            done ? "text-neutral-400 line-through" : ""
          }`}
        >
          {child.title}
        </button>
        {readOnly ? (
          assigned.length > 0 && <AvatarStack users={assigned} size={18} />
        ) : (
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
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <SortableChecklist
        items={items}
        disabled={readOnly}
        lifted={(child) => step(child, undefined, true)}
      >
        {(child, drag) => step(child, drag)}
      </SortableChecklist>
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
      {readOnly ? (
        items.length === 0 && <p className="px-1 text-sm text-neutral-400">No steps.</p>
      ) : (
      <TitleField
        variant="line"
        inputRef={input}
        title={draft}
        onTitle={setDraft}
        parts={line.parts}
        saved={line.saved}
        struck={line.struck}
        onKeep={line.onKeep}
        onDrop={line.onDrop}
        disabled={false}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            add();
          }
        }}
        placeholder={rows ? "Add another…" : "Add a step…"}
        // Not the task's title (see TitleField's label).
        label="Add a sub-item"
      />
      )}
    </div>
  );
}
/**
 * The item's fields for someone who can view or comment on its list but not
 * change it: what the editable chips show, as plain text.
 */
function ReadOnlyFields({
  item,
  parent,
  assigned,
  labelEmoji,
  onOpenItem,
}: {
  item: Item;
  parent: Item | null;
  assigned: AssigneeView[];
  labelEmoji: (name: string) => string | null;
  onOpenItem: (item: Item) => void;
}) {
  const repeat = repeatOf(item);
  const done = item.completedAt !== null;
  const any =
    item.dueDate || item.somedayAt !== null || repeat || assigned.length > 0 || item.labels.length > 0 || parent;
  return (
    <div className="space-y-3 pl-8">
      {item.description?.trim() && (
        <div className="break-words text-sm text-neutral-600 dark:text-neutral-300">
          <Markdown>{item.description}</Markdown>
        </div>
      )}
      {any && (
        <div className="flex flex-wrap items-center gap-1.5">
          {item.dueDate ? (
            <DueBadge due={item.dueDate} from={item.dueFrom} done={done} smart={item.smartRule} />
          ) : (
            item.smartRule && <WaitingBadge rule={item.smartRule} />
          )}
          {item.somedayAt !== null && <SomedayBadge />}
          {repeat && <RepeatBadge repeat={repeat} completedAt={item.completedAt} />}
          {assigned.length > 0 && (
            <span className="inline-flex items-center gap-1.5 text-xs text-neutral-500">
              <AvatarStack users={assigned} size={18} />
              {assigneeNames(assigned)}
            </span>
          )}
          {item.labels.map((name) => (
            <LabelBadge key={name} name={name} emoji={labelEmoji(name)} />
          ))}
          {parent && (
            <button type="button" onClick={() => onOpenItem(parent)} className={CHIP}>
              <CornerLeftUp />
              <span className="max-w-48 truncate">{parent.title}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

type ItemDetailProps = {
  item: Item;
  /** For a sub-item, the task it belongs to. */
  parent: Item | null;
  /** For a sub-item whose task the viewer can't see (hiddenParentTitles): just its title. */
  parentTitle?: string;
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
  /** An Activity row to open at, ready to react to: a push about it was tapped. */
  focusActivity?: string | null;
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
      <ResponsiveDialogContent
        // Opened to read as much as to edit, and its single-key shortcuts
        // would type into a focused field: the comment box waits to be picked.
        initialFocus={null}
      >
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
  parentTitle,
  checklist,
  nestTargets,
  onOpenItem,
  prefix,
  assignees,
  viewerId,
  prLinks,
  open,
  cameFrom = null,
  focusActivity = null,
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
  // A viewer or commenter reads it all, changing nothing (commenters comment).
  const access = useListAccess(item.projectId);
  const canEdit = access === "edit";
  const listLabels = useListLabels(item.projectId);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const saves = useItemSaves();
  const [assignOpen, setAssignOpen] = useState(false);
  // A sub-item's assignee picker in the checklist, when one is open.
  const [childPickerFor, setChildPickerFor] = useState<string | null>(null);
  const completed = item.completedAt !== null;
  // Closed without being done: an ✕ and a dashed strike, never the green tick.
  const cancelled = completed && item.cancelled;
  const [cancelOpen, setCancelOpen] = useState(false);
  // Done and cancelled titles share the strike; the ✕ and chip tell them apart.
  const strike = "text-neutral-400 line-through";
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
        saves.updateItem(item.id, {
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
    active: open && childPickerFor === null && !dueOpen && canEdit,
    onOpenPicker: openPicker,
    onAssignToMe: canAssignSelf ? toggleMe : undefined,
    onDue: () => !pending && setDueOpen(true),
    onToggleDone: () => toggle(),
    onCancel: completed ? undefined : () => !pending && setCancelOpen(true),
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
    if (selection?.get() === item.id) selection.select(rowAfterDelete(item.id));
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
        {!canEdit ? (
          <span
            role="img"
            aria-label={cancelled ? "Cancelled" : completed ? "Done" : "Not done"}
            className={`mt-px shrink-0 ${cancelled ? "text-neutral-400" : completed ? "text-green-600 dark:text-green-500" : "text-neutral-300 dark:text-neutral-600"}`}
          >
            {cancelled ? <CircleX className="size-6" /> : completed ? <CheckCircle2 className="size-6" /> : <Circle className="size-6" />}
          </span>
        ) : (
        <button
          type="button"
          // Shift-click cancels instead, as on the board's circle.
          onClick={(e) => (e.shiftKey && !completed ? setCancelOpen(true) : toggle())}
          disabled={pending}
          aria-pressed={completed}
          aria-label={cancelled ? "Cancelled" : completed ? "Completed" : "Complete"}
          title={cancelled ? "Reopen (X)" : completed ? "Mark as not done (X)" : "Complete (X) · Shift-click to cancel (⇧X)"}
          className={`mt-px shrink-0 rounded-full transition disabled:opacity-50 ${
            cancelled
              ? "text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
              : completed
              ? "text-green-600 hover:text-green-700 dark:text-green-500"
              : "text-neutral-400 hover:text-green-600 dark:text-neutral-500 dark:hover:text-green-500"
          }`}
        >
          {cancelled ? <CircleX className="size-6" /> : completed ? <CheckCircle2 className="size-6" /> : <Circle className="size-6" />}
        </button>
        )}
        <ResponsiveDialogTitle className="min-w-0 flex-1">
          {!canEdit ? (
            <span
              className={`block w-full break-words text-base leading-6 font-medium ${
                completed ? strike : ""
              }`}
            >
              <InlineCode>{item.title}</InlineCode>
            </span>
          ) : (
          <EditableText
            value={item.title}
            draftKey={`item:${item.id}:title`}
            onSave={(next) =>
              runAction(saves.updateItem(item.id, { title: next }), `rename “${item.title}”`)
            }
            required
            className={`block w-full break-words text-base leading-6 font-medium ${
              completed ? strike : ""
            }`}
            inputClassName="w-full text-base"
            renderValue={(title) => <InlineCode>{title}</InlineCode>}
          />
          )}
        </ResponsiveDialogTitle>
      </div>
      <ResponsiveDialogDescription className="sr-only">
        Item details for {item.title}
      </ResponsiveDialogDescription>
      {!canEdit ? (
        <ReadOnlyFields
          item={item}
          parent={parent}
          assigned={assigned}
          labelEmoji={(name) => listLabels.find((l) => l.name === name)?.emoji ?? null}
          onOpenItem={onOpenItem}
        />
      ) : (
      <div className="space-y-3 pl-8">
        <EditableText
          value={item.description ?? ""}
          draftKey={`item:${item.id}:description`}
          onSave={(next) =>
            runAction(
              saves.updateItem(item.id, { description: next || null }),
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
            key={`due:${item.id}`}
            open={dueOpen}
            setOpen={setDueOpen}
            due={item.dueDate ? { dueDate: item.dueDate, dueFrom: item.dueFrom } : null}
            done={completed}
            disabled={pending}
            onChange={(due) =>
              start(async () => {
                await runAction(
                  // Clear on Someday brings it back undated.
                  saves.updateItem(item.id, due ?? (item.somedayAt !== null ? { someday: false } : { dueDate: null })),
                  `change the due date of “${item.title}”`,
                );
              })
            }
            someday={item.somedayAt !== null}
            onSomeday={
              item.parentId === null
                ? () =>
                    start(async () => {
                      await runAction(
                        saves.updateItem(item.id, { someday: true }),
                        `move “${item.title}” to Someday`,
                      );
                    })
                : undefined
            }
            smart={
              repeatOf(item)
                ? undefined
                : {
                    rule: item.smartRule,
                    panel: (onPlain) => <SmartDuePanel item={item} disabled={pending} onPlain={onPlain} />,
                  }
            }
          />
          <RepeatChip
            key={`repeat:${item.id}`}
            repeat={repeatOf(item)}
            completedAt={item.completedAt}
            // A smart due date can't repeat yet (core/smartDue.ts).
            disabled={pending || item.smartRule !== null}
            onChange={(repeat) =>
              start(async () => {
                await runAction(
                  saves.updateItem(item.id, { repeat }),
                  `change how “${item.title}” repeats`,
                );
              })
            }
          />
          <AssigneeChip
            assigned={assigned}
            disabled={pending}
            open={assignOpen}
            setOpen={setAssignOpen}
          >
            <AssigneeOptions
              selected={assigneeIds}
              assignees={assignees}
              viewerId={viewerId}
              onChange={assign}
              agents={agentOptions}
              onAgentChange={setAgent}
            />
          </AssigneeChip>
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
                <span className="max-w-48 truncate">
                  {parent.completedAt !== null ? (
                    <Struck className="[--strike-gap:var(--color-popover)]">{parent.title}</Struck>
                  ) : (
                    parent.title
                  )}
                </span>
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
          ) : parentTitle ? (
            <span title="Sub-item of" className={CHIP}>
              <IndentIncrease />
              <span className="max-w-48 truncate">{parentTitle}</span>
            </span>
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
      )}
    </div>

    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4">
      <AgentWork item={item} assignees={assignees} />

      {!parent && !item.parentId && (
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
            readOnly={!canEdit}
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

      <ItemSource itemId={item.id} />

      <Field label="Comments">
        <ItemComments key={item.id} item={item} viewerId={viewerId} people={assignees} />
      </Field>

      <ItemActivity item={item} viewerId={viewerId} focus={focusActivity} />
    </div>

    <div className="flex shrink-0 items-center justify-between border-t border-neutral-200 px-4 py-2.5 dark:border-neutral-800">
      <span data-replay-safe className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-neutral-400">
        {cancelled && item.completedAt ? (
          <>
            <span>
              Cancelled {dayLabel(item.completedAt)}
              {item.cancelReason && `: ${item.cancelReason}`}
            </span>
            <CancelledChip item={item} />
          </>
        ) : completed && item.completedAt ? (
          `Completed ${dayLabel(item.completedAt)}`
        ) : (
          `Created ${dayLabel(item.createdAt)}`
        )}
      </span>
      {canEdit ? (
        <span className="flex shrink-0 items-center gap-1">
        {!completed && (
          <Button
            variant="ghost"
            size="sm"
            data-replay-safe
            onClick={() => setCancelOpen(true)}
            disabled={pending}
            className="text-neutral-500"
          >
            <CircleX />
            Cancel…
          </Button>
        )}
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
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-xs text-neutral-400">
          {access === "comment" ? <MessageSquare className="size-3.5" /> : <Eye className="size-3.5" />}
          {access === "comment" ? "Can comment" : "View only"}
        </span>
      )}
    </div>
    {cancelOpen && <CancelItemDialog item={item} open={cancelOpen} onOpenChange={setCancelOpen} />}
    </>
  );
}

/**
 * The photo of a page an item was added from, whole, with its line
 * highlighted. Nothing for an item that wasn't added from one.
 */
function ItemSource({ itemId }: { itemId: string }) {
  // Keyed by item, so moving to another item never shows this one's photo.
  const [loaded, setLoaded] = useState<{
    itemId: string;
    source: Awaited<ReturnType<typeof getItemSourceAction>>;
  } | null>(null);
  useEffect(() => {
    let stale = false;
    // Only an extra: if it doesn't load, the item reads the same without it.
    getItemSourceAction(itemId).then(
      (source) => !stale && setLoaded({ itemId, source }),
      (error) => unstable_rethrow(error),
    );
    return () => {
      stale = true;
    };
  }, [itemId]);
  const source = loaded?.itemId === itemId ? loaded.source : null;
  if (!source) return null;
  return (
    <Field label={`From a photo · ${dayLabel(source.createdAt)}`}>
      <a href={`/api/sources/${source.sourceId}/photo`} target="_blank" rel="noreferrer" className="block">
        <SourcePhoto sourceId={source.sourceId} highlight={source.region} />
      </a>
    </Field>
  );
}
