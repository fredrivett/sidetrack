"use client";

import { ArrowRight, Check, ChevronDown, List, Trash2, Undo2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { addFromSourceAction, createProjectAction, discardSourceAction } from "@/app/actions";
import type { LabelEmoji } from "@/core/labels";
import type { AssigneeView } from "@/core/members";
import type { Label } from "@/core/schema";
import type { SourceView } from "@/core/sources";
import type { Repeat } from "@/lib/repeat";
import type { Due } from "@/lib/time";
import { cn } from "@/lib/utils";
import { AssigneeOptions } from "./AssigneeOptions";
import { CreatableCombobox } from "./CreatableCombobox";
import { AssigneeChip, CHIP, DueChip, EMPTY_CHIP, RepeatChip } from "./DialogFields";
import { DueBadge } from "./DueBadge";
import { BRANCH, TRUNK } from "./ItemList";
import { LabelBadge, LabelChips, LabelsContext, useListLabels } from "./Labels";
import { ProjectIcon } from "./ProjectIcon";
import { RepeatBadge } from "./RepeatBadge";
import { runAction } from "./run-action";
import { SourcePhoto } from "./SourcePhoto";
import { spaceTint } from "./SpaceColor";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Fold } from "./ui/fold";
import { AgentAvatar, AvatarStack } from "./UserAvatar";

type ListOption = { id: string; name: string; icon: string | null; homepageUrl: string | null };
/** An existing item a line matches, as it is now. */
type Match = {
  ref: string;
  title: string;
  projectId: string;
  completedAt: number | null;
  due: Due | null;
  repeat: Repeat | null;
  labels: string[];
  assigneeIds: string[];
};
/** A line as the reviewer has it: the item it will add, or a match as it will end up. */
type Row = {
  add: boolean;
  title: string;
  projectId: string;
  done: boolean;
  due: Due | null;
  repeat: Repeat | null;
  labels: string[];
  labelEmoji: Record<string, LabelEmoji>;
  assigneeIds: string[];
};
type Line = SourceView["lines"][number];

const day = (dueDate: string | null): Due | null => (dueDate ? { dueDate, dueFrom: null } : null);
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
const sameRepeat = (a: Repeat | null, b: Repeat | null) =>
  a?.every === b?.every && a?.unit === b?.unit && (a?.on ?? null) === (b?.on ?? null) &&
  (a?.day ?? null) === (b?.day ?? null);

/** A line's starting row: what the agent read, laid over the item it matches. */
function initialRow(line: Line, match: Match | undefined): Row {
  if (!match) {
    return {
      add: true,
      title: line.title,
      projectId: line.projectId,
      done: line.done,
      due: day(line.dueDate),
      repeat: line.repeat,
      labels: line.labels,
      labelEmoji: {},
      assigneeIds: line.assigneeIds,
    };
  }
  return {
    add: true,
    title: match.title,
    projectId: match.projectId,
    done: line.done || match.completedAt !== null,
    due: line.dueDate ? day(line.dueDate) : match.due,
    repeat: line.repeat ?? match.repeat,
    labels: [...new Set([...match.labels, ...line.labels])],
    labelEmoji: {},
    assigneeIds: line.assigneeIds.length ? line.assigneeIds : match.assigneeIds,
  };
}

/** Whether adding a matched line would change its item, beyond linking it to the photo. */
function changesMatch(row: Row, match: Match): { ticks: boolean; edits: boolean } {
  return {
    ticks: row.done && match.completedAt === null,
    edits:
      row.title.trim() !== match.title ||
      (row.due?.dueDate ?? null) !== (match.due?.dueDate ?? null) ||
      !sameRepeat(row.repeat, match.repeat) ||
      !sameSet(row.labels, match.labels) ||
      !sameSet(row.assigneeIds, match.assigneeIds),
  };
}

/**
 * The photo an agent read beside what it found on it, laid out like the
 * board: new items under the list they'll go to, with their sub-items, and
 * the items already in Sidetrack in a section of their own, each saying
 * what Add will do to it. Tapping a row highlights its line on the photo
 * and opens it with the same fields as New item; ✕ leaves it out. Nothing
 * is on the board until Add.
 */
export function SourceReview({
  source,
  lists,
  matches,
  labelsByProject,
  assigneesByProject,
  viewerId,
}: {
  source: SourceView;
  lists: ListOption[];
  matches: Record<string, Match>;
  labelsByProject: Record<string, Label[]>;
  assigneesByProject: Record<string, AssigneeView[]>;
  viewerId: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(
      source.lines.map((l) => [l.id, initialRow(l, l.matchItemId ? matches[l.matchItemId] : undefined)]),
    ),
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  const set = (id: string, patch: Partial<Row>) =>
    setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }));
  const region = source.lines.find((l) => l.id === selected)?.region ?? null;

  if (source.reviewedAt !== null) {
    return (
      <Notice title="These are already on the board">
        <Button render={<Link href="/" />} nativeButton={false}>
          Go to the board
        </Button>
      </Notice>
    );
  }
  if (!source.hasPhoto) {
    return (
      <Notice title="Waiting for the photo">
        {source.agentName ?? "The agent"} read {source.lines.length} lines but hasn&apos;t uploaded the
        photo yet. Ask it to try the upload again.
      </Notice>
    );
  }

  // New top-level lines grouped by the list they'll go to, in page order,
  // each with its sub-item lines; then the lines that are items already.
  const newLines = source.lines.filter((l) => !l.matchItemId);
  const subsOf = (id: string) => newLines.filter((l) => l.parentLineId === id);
  const tops = newLines.filter((l) => !l.parentLineId);
  const groups = [...new Set(tops.map((l) => rows[l.id].projectId))].map((projectId) => ({
    projectId,
    lines: tops.filter((l) => rows[l.id].projectId === projectId),
  }));
  const matched = source.lines.filter((l) => l.matchItemId && matches[l.matchItemId]);

  const counts = { added: 0, updated: 0, ticked: 0 };
  for (const l of source.lines) {
    const r = rows[l.id];
    if (!r.add) continue;
    const m = l.matchItemId ? matches[l.matchItemId] : undefined;
    if (!m) counts.added++;
    else {
      const c = changesMatch(r, m);
      if (c.edits) counts.updated++;
      if (c.ticks) counts.ticked++;
    }
  }
  const summary = [
    counts.added && `Add ${counts.added}`,
    counts.updated && `update ${counts.updated}`,
    counts.ticked && `tick off ${counts.ticked}`,
  ].filter(Boolean) as string[];

  function pick(id: string) {
    setSelected(id);
    document.getElementById(`line-${id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  async function add() {
    setSaving(true);
    let result: Awaited<ReturnType<typeof addFromSourceAction>> | undefined;
    const ok = await runAction(
      addFromSourceAction(
        source.id,
        source.lines.map((l) => {
          const r = rows[l.id];
          return {
            id: l.id,
            add: r.add,
            title: r.title,
            projectId: r.projectId,
            done: r.done,
            dueDate: r.due?.dueDate ?? null,
            repeat: r.repeat,
            labels: r.labels,
            labelEmoji: r.labelEmoji,
            assigneeIds: r.assigneeIds,
          };
        }),
      ).then((r) => (result = r)),
      "add these to Sidetrack",
    );
    setSaving(false);
    if (!ok || !result) return;
    const parts = [
      result.added && `Added ${result.added}`,
      result.updated && `updated ${result.updated}`,
      result.completed && `ticked off ${result.completed}`,
    ].filter(Boolean);
    toast.success(parts.length ? parts.join(", ") : "Nothing to add");
    router.push("/");
  }

  async function discard() {
    if (!confirmingDiscard) {
      setConfirmingDiscard(true);
      return;
    }
    setSaving(true);
    const ok = await runAction(discardSourceAction(source.id), "discard this photo");
    setSaving(false);
    if (ok) router.push("/");
  }

  const rowProps = (line: Line) => ({
    line,
    row: rows[line.id],
    open: selected === line.id,
    onSelect: () => setSelected(selected === line.id ? null : line.id),
    onChange: (patch: Partial<Row>) => set(line.id, patch),
    lists,
    assigneesByProject,
    viewerId,
  });
  const regions = source.lines.flatMap((l) => (l.region ? [{ id: l.id, region: l.region }] : []));

  const groupRows = (groupLines: Line[]) =>
    groupLines.map((line) => {
      const subs = subsOf(line.id);
      return (
        <div key={line.id} className="space-y-1.5">
          <ReviewRow {...rowProps(line)} />
          {subs.map((sub, i) => (
            <div key={sub.id} className="ml-4 pl-5">
              <div className={i === subs.length - 1 ? BRANCH : `${BRANCH} ${TRUNK}`}>
                <ReviewRow {...rowProps(sub)} />
              </div>
            </div>
          ))}
        </div>
      );
    });
  const listHeader = (projectId: string) => {
    const list = lists.find((p) => p.id === projectId);
    return (
      <>
        {list && <ProjectIcon icon={list.icon} homepageUrl={list.homepageUrl} name={list.name} size={20} />}
        <span className="truncate">{list?.name ?? "A list"}</span>
      </>
    );
  };
  const countOf = (ls: Line[]) =>
    ls.reduce((n, l) => n + 1 + subsOf(l.id).length, 0);

  return (
    <LabelsContext value={labelsByProject}>
      <div data-source-review className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]">
        <div className="sticky top-0 z-10 -mx-4 bg-neutral-50 px-4 pb-2 sm:-mx-6 sm:px-6 md:top-4 md:mx-0 md:self-start md:px-0 md:pb-0 dark:bg-neutral-950">
          <SourcePhoto
            sourceId={source.id}
            highlight={region}
            regions={regions}
            onPick={pick}
            className="[--photo-max-h:38dvh] md:[--photo-max-h:calc(100dvh-2rem)]"
          />
        </div>
        <div className="min-w-0 pb-20 md:pb-0">
          <h1 className="text-lg font-semibold tracking-tight">Add these to Sidetrack</h1>
          <AgentNote name={source.agentName} lines={source.lines.length} note={source.note} id={source.id} />
          <div className="mt-5 space-y-3">
            {groups.map(({ projectId, lines: groupLines }) => (
              <ListCard key={projectId} title={listHeader(projectId)} count={countOf(groupLines)}>
                {groupRows(groupLines)}
              </ListCard>
            ))}
            {matched.length > 0 && (
              <ListCard title={<span>Already in Sidetrack</span>} count={matched.length}>
                {matched.map((line) => (
                  <ReviewRow key={line.id} {...rowProps(line)} match={matches[line.matchItemId as string]} />
                ))}
              </ListCard>
            )}
          </div>
          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-neutral-200 bg-neutral-50/95 backdrop-blur md:static md:mt-6 md:border-0 md:bg-transparent md:backdrop-blur-none dark:border-neutral-800 dark:bg-neutral-950/95">
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3 sm:px-6 md:px-0 md:py-0">
              <Button
                variant={confirmingDiscard ? "destructive" : "ghost"}
                onClick={discard}
                onBlur={() => setConfirmingDiscard(false)}
                disabled={saving}
                className={confirmingDiscard ? "" : "text-neutral-500 hover:text-destructive"}
              >
                <Trash2 />
                {confirmingDiscard ? "Confirm discard?" : "Discard"}
              </Button>
              <Button onClick={add} disabled={saving || summary.length === 0}>
                <Check />
                {summary.length ? summary.join(", ").replace(/^./, (c) => c.toUpperCase()) : "Nothing to add"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </LabelsContext>
  );
}

/**
 * One list's lines in a grey tray that folds, like an uncoloured tray on the
 * board, so the rows sit in it as they do there.
 */
function ListCard({
  title,
  count,
  children,
}: {
  title: React.ReactNode;
  count: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className={cn("rounded-2xl p-1.5", spaceTint(null))}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-base font-semibold"
      >
        {title}
        <span className="text-xs font-normal text-neutral-500 tabular-nums">{count}</span>
        <ChevronDown
          aria-hidden
          className={cn("ml-auto size-4 text-neutral-500 transition-transform", !open && "-rotate-90")}
        />
      </button>
      <Fold open={open} className="space-y-1.5 pt-0.5">
        {children}
      </Fold>
    </section>
  );
}

/** The agent's own words about the page, as a message from it. */
function AgentNote({
  id,
  name,
  lines,
  note,
}: {
  id: string;
  name: string | null;
  lines: number;
  note: string | null;
}) {
  const agent = name ?? "Your agent";
  return (
    <div className="mt-3 flex gap-2.5">
      <AgentAvatar agent={{ id, name: agent }} size={24} className="mt-0.5" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-xs text-neutral-500">
          <span className="font-medium text-neutral-700 dark:text-neutral-300">{agent}</span> read {lines}{" "}
          line{lines === 1 ? "" : "s"} off this page
        </p>
        <div className="rounded-lg rounded-tl-sm bg-white px-3 py-2 text-sm text-neutral-700 ring-1 ring-neutral-200 dark:bg-neutral-900 dark:text-neutral-300 dark:ring-neutral-800">
          {note ?? "Here's what I found. Check it against the photo, change anything I got wrong, then add."}
        </div>
      </div>
    </div>
  );
}

/**
 * One line, as a board row: the round checkbox is whether it's done, then
 * its title and badges. A matched line says what Add does to its item.
 * Open, it shows New item's fields under the title.
 */
function ReviewRow({
  line,
  row,
  match,
  open,
  onSelect,
  onChange,
  lists,
  assigneesByProject,
  viewerId,
}: {
  line: Line;
  row: Row;
  match?: Match;
  open: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<Row>) => void;
  lists: ListOption[];
  assigneesByProject: Record<string, AssigneeView[]>;
  viewerId: string;
}) {
  const projectId = match?.projectId ?? row.projectId;
  const assignees = assigneesByProject[projectId] ?? [];
  const labels = useListLabels(projectId);
  const people = assignees.filter((a) => row.assigneeIds.includes(a.userId));
  const sub = line.parentLineId !== null || line.parentItemId !== null;
  const alreadyDone = match?.completedAt != null;

  if (!row.add) {
    return (
      <div
        id={`line-${line.id}`}
        onClick={onSelect}
        className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-neutral-400/60 p-2 dark:border-neutral-600"
      >
        <span className="min-w-0 flex-1 truncate text-sm text-neutral-400">
          {match && <span className="mr-1 font-mono text-xs">{match.ref}</span>}
          {row.title}
        </span>
        <span className="text-xs text-neutral-400">{match ? "Left as it is" : "Left out"}</span>
        <Button
          variant="ghost"
          size="xs"
          onClick={(e) => {
            e.stopPropagation();
            onChange({ add: true });
          }}
        >
          <Undo2 />
          Put back
        </Button>
      </div>
    );
  }

  return (
    <div
      id={`line-${line.id}`}
      onClick={onSelect}
      className={cn(
        "group flex cursor-pointer items-start gap-2 rounded-lg border bg-white p-2 transition-colors dark:bg-neutral-900",
        open
          ? "border-amber-400 ring-1 ring-amber-400"
          : "border-neutral-200 hover:border-neutral-300 dark:border-neutral-800 dark:hover:border-neutral-700",
      )}
    >
      {/* As on the board: the wrapper stops the click opening the row. */}
      <span className="mt-0.5 flex" onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={row.done}
          readOnly={alreadyDone}
          onCheckedChange={(done) => onChange({ done })}
          aria-label={row.done ? `Not done: ${row.title}` : `Done: ${row.title}`}
        />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        {open ? (
          <input
            value={row.title}
            onChange={(e) => onChange({ title: e.target.value })}
            onClick={(e) => e.stopPropagation()}
            aria-label="Title"
            autoFocus
            className="block w-full bg-transparent text-sm leading-5 outline-none"
          />
        ) : (
          <Collapsed row={row} labels={labels} />
        )}
        {match && <MatchOutcome row={row} match={match} />}
        {open ? (
          <div onClick={(e) => e.stopPropagation()}>
            <Fields
              row={row}
              projectId={projectId}
              canMove={!match && !sub}
              lists={lists}
              assignees={assignees}
              viewerId={viewerId}
              onChange={onChange}
            />
          </div>
        ) : null}
      </div>
      <div className="flex h-5 shrink-0 items-center gap-1">
        {people.length > 0 && <AvatarStack users={people} size={20} />}
        <ChevronDown
          aria-hidden
          className={cn("size-3.5 text-neutral-400 transition-transform", open && "rotate-180")}
        />
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={match ? `Leave ${match.ref} as it is` : `Leave out “${row.title}”`}
          title={match ? "Leave as it is" : "Leave out"}
          onClick={(e) => {
            e.stopPropagation();
            onChange({ add: false });
          }}
          className="text-neutral-400 opacity-0 group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100 touch:opacity-100"
        >
          <X />
        </Button>
      </div>
    </div>
  );
}

/** A collapsed row: the title, then its date, repeat and labels inline after it. */
function Collapsed({ row, labels }: { row: Row; labels: Label[] }) {
  const hasDetails = row.due || row.repeat || row.labels.length > 0;
  return (
    <p className={cn("text-sm leading-5 break-words", row.done && "text-neutral-400")}>
      <span className={row.done ? "line-through" : undefined}>{row.title}</span>
      {hasDetails && (
        <span className="ml-1.5 inline-flex translate-y-[-1px] flex-wrap items-center gap-1 align-middle">
          {row.due && <DueBadge due={row.due.dueDate} from={row.due.dueFrom} done={row.done} />}
          {row.repeat && <RepeatBadge repeat={row.repeat} completedAt={null} />}
          {row.labels.map((name) => (
            <LabelBadge
              key={name}
              name={name}
              emoji={labels.find((l) => l.name === name)?.emoji ?? row.labelEmoji[name]?.emoji ?? null}
            />
          ))}
        </span>
      )}
    </p>
  );
}

/**
 * What Add does to an item that's already in Sidetrack, before and after:
 * where it is, then each change, so ticking it off can't go unnoticed.
 */
function MatchOutcome({ row, match }: { row: Row; match: Match }) {
  const { ticks, edits } = changesMatch(row, match);
  const dueChanged = (row.due?.dueDate ?? null) !== (match.due?.dueDate ?? null);
  return (
    <div className="flex flex-wrap items-center gap-1 text-[11px] text-neutral-500">
      <span className="font-mono text-neutral-400">{match.ref}</span>
      {ticks && (
        <span className="inline-flex items-center gap-0.5 rounded bg-green-50 px-1.5 py-0.5 font-medium text-green-700 dark:bg-green-950/40 dark:text-green-400">
          <Check className="size-3" />
          Ticks it off
        </span>
      )}
      {dueChanged && (
        <span className="inline-flex items-center gap-1">
          {match.due ? (
            <DueBadge due={match.due.dueDate} from={match.due.dueFrom} done={false} />
          ) : (
            <span>No date</span>
          )}
          <ArrowRight className="size-3" />
          {row.due ? <DueBadge due={row.due.dueDate} from={row.due.dueFrom} done={false} /> : <span>No date</span>}
        </span>
      )}
      {!sameRepeat(row.repeat, match.repeat) &&
        (row.repeat ? <RepeatBadge repeat={row.repeat} completedAt={null} /> : <span>Stops repeating</span>)}
      {row.labels
        .filter((l) => !match.labels.includes(l))
        .map((l) => (
          <span key={l}>+{l}</span>
        ))}
      {row.title.trim() !== match.title && <span>Renamed from “{match.title}”</span>}
      {!sameSet(row.assigneeIds, match.assigneeIds) && <span>New assignees</span>}
      {!ticks && !edits && <span>{match.completedAt !== null ? "Done already · no change" : "No change"}</span>}
    </div>
  );
}

/** New item's fields, for the open row. */
function Fields({
  row,
  projectId,
  canMove,
  lists,
  assignees,
  viewerId,
  onChange,
}: {
  row: Row;
  projectId: string;
  /** A new top-level line can go to another list; a sub-item goes with its parent. */
  canMove: boolean;
  lists: ListOption[];
  assignees: AssigneeView[];
  viewerId: string;
  onChange: (patch: Partial<Row>) => void;
}) {
  const [dueOpen, setDueOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [creating, startCreate] = useTransition();
  const list = lists.find((p) => p.id === row.projectId);
  const assigned = assignees.filter((a) => row.assigneeIds.includes(a.userId));

  function createList(name: string) {
    startCreate(async () => {
      await runAction(
        createProjectAction({ name, iconChosen: false }).then((created) =>
          onChange({ projectId: created.id, assigneeIds: [] }),
        ),
        "create the list",
      );
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-1">
      {canMove && (
        <CreatableCombobox
          options={lists.map((p) => ({ value: p.id, label: p.name }))}
          value={row.projectId}
          // People belong to a list; labels come along, made on the new one.
          onChange={(id) => onChange({ projectId: id, assigneeIds: [] })}
          onCreate={createList}
          placeholder="Find or create a list…"
          title="List"
          disabled={creating}
          className={CHIP}
        >
          {list ? (
            <>
              <ProjectIcon icon={list.icon} homepageUrl={list.homepageUrl} name={list.name} size={16} />
              <span className="min-w-0 truncate">{list.name}</span>
            </>
          ) : (
            <>
              <List />
              <span>Choose a list</span>
            </>
          )}
        </CreatableCombobox>
      )}
      <DueChip
        due={row.due}
        done={row.done}
        disabled={false}
        onChange={(due) => onChange({ due })}
        open={dueOpen}
        setOpen={setDueOpen}
      />
      <RepeatChip repeat={row.repeat} completedAt={null} disabled={false} onChange={(repeat) => onChange({ repeat })} />
      <AssigneeChip assigned={assigned} disabled={false} open={assignOpen} setOpen={setAssignOpen}>
        <AssigneeOptions
          selected={row.assigneeIds}
          assignees={assignees}
          viewerId={viewerId}
          onChange={(assigneeIds) => onChange({ assigneeIds })}
        />
      </AssigneeChip>
      <LabelChips
        projectId={projectId}
        value={row.labels}
        onChange={(labels, added) =>
          onChange({
            labels,
            ...(added?.emoji && { labelEmoji: { ...row.labelEmoji, [added.name]: added.emoji } }),
          })
        }
        draftEmoji={row.labelEmoji}
        onDraftEmoji={(name, emoji) =>
          onChange({ labelEmoji: { ...row.labelEmoji, [name]: { emoji, chosen: true } } })
        }
        chipClassName={row.labels.length ? `${EMPTY_CHIP} px-2` : EMPTY_CHIP}
      />
    </div>
  );
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto mt-16 flex max-w-sm flex-col items-center gap-3 text-center">
      <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      <div className="text-sm text-neutral-500">{children}</div>
    </div>
  );
}
