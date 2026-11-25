"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { unstable_rethrow } from "next/navigation";
import { listAuditAction, listRecentCommentsAction } from "@/app/actions";
import type { AuditEntryWithActor } from "@/core/audit";
import type { FeedComment } from "@/core/comments";
import type { AssigneeView } from "@/core/members";
import type { AuditSource, Item, Project } from "@/core/schema";
import { formatItemRef } from "@/lib/itemRef";
import { dayLabel, formatRelative } from "@/lib/time";
import {
  ResponsiveDialog,
  ResponsiveDialogCloseButton,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Reactions } from "./Reactions";
import { DueBadge } from "./DueBadge";
import { runAction } from "./run-action";
import { CommentCard } from "./ItemComments";
import { Struck } from "./Struck";
import { AvatarStack } from "./UserAvatar";

const PAGE = 100;

const SOURCE_BADGE: Record<AuditSource, string> = {
  web: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  mcp: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200",
  github: "bg-neutral-200 text-neutral-800 dark:bg-neutral-700 dark:text-neutral-100",
  system: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
};

const ACTION_LABEL: Record<string, string> = {
  create: "created",
  update: "updated",
  complete: "completed",
  uncomplete: "reopened",
  reorder: "reordered",
  delete: "deleted",
  link: "linked",
  unlink: "unlinked",
  start: "started",
  report: "reported",
  finish: "finished",
};

// "comments" shows the comments themselves rather than the log's rows.
type Filter = "all" | AuditSource | "comments";

const FILTERS = ["all", "web", "mcp", "github", "system", "comments"] as const;

// The verbs src/core starts an audit detail with when it reads as a sentence
// ("deleted "Milk"", "made @fred an admin of …"). A detail that starts any
// other way, such as with an item's name, gets the action in front.
const DETAIL_VERBS = new Set([
  "accepted",
  "added",
  "commented",
  "completed",
  "created",
  "declined",
  "deleted",
  "edited",
  "ended",
  "finished",
  "invited",
  "left",
  "linked",
  "made",
  "minted",
  "moved",
  "removed",
  "reopened",
  "reordered",
  "reported",
  "resumed",
  "revoked",
  "set",
  "sorted",
  "started",
  "unlinked",
]);

/** One audit row: its source, what happened, when, and who did it. */
export function AuditEntryRow({
  entry: e,
  listName,
  className,
  react,
}: {
  entry: AuditEntryWithActor;
  /** Shows a person's change's reactions (an item's history), and with canReact, a button to add one.
   * `focused`: the row a push opened at, marked, its button showing. */
  react?: { viewerId: string; canReact: boolean; focused?: boolean };
  /** The list it happened in, for a view that spans lists. */
  listName?: string;
  className?: string;
}) {
  // The agent ahead of the person it acted for, as on a board row; no face
  // for a system change or a deleted user.
  const users =
    e.source !== "system" && e.actorName !== null
      ? [{ userId: e.actor, name: e.actorName, image: e.actorImage, displayUsername: null, email: null }]
      : [];
  const agents = e.agentName ? [{ id: e.id, name: e.agentName }] : [];
  // Most details read as a sentence that starts with what happened
  // ("deleted "Milk""); the rest only name what changed ("Milk: edited
  // description", "avatar"), so the action goes first.
  const label = ACTION_LABEL[e.action] ?? e.action;
  const sentence = !e.detail
    ? label
    : DETAIL_VERBS.has(e.detail.split(" ", 1)[0])
      ? e.detail
      : `${label} ${e.detail}`;
  const space = sentence.indexOf(" ");
  const verb = space === -1 ? sentence : sentence.slice(0, space);
  const rest = space === -1 ? "" : sentence.slice(space + 1);
  return (
    <li
      id={react?.focused ? `activity-${e.id}` : undefined}
      className={`group/reactable relative flex items-start gap-2 ${react?.focused ? "-mx-2 rounded-lg bg-blue-50 px-2 py-1.5 dark:bg-blue-950/40" : ""} ${className ?? ""}`}
    >
      <span
        className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${SOURCE_BADGE[e.source]}`}
      >
        {e.source}
      </span>
      <div className="min-w-0 flex-1">
        {e.parts ? (
          // Who and what stand out; the words between them don't.
          <p className="break-words text-sm text-neutral-600 dark:text-neutral-300">
            {e.parts.map((part, i) =>
              part.due ? (
                <DueBadge key={i} due={part.due.dueDate} from={part.due.dueFrom} done />
              ) : part.em ? (
                <span key={i} className="font-medium text-foreground">
                  {part.done ? <Struck className="[--strike-gap:var(--color-popover)]">{part.text}</Struck> : part.text}
                </span>
              ) : (
                part.text
              ),
            )}
          </p>
        ) : (
          <p className="break-words text-sm">
            <span className="font-medium">{verb}</span>{" "}
            <span className="text-neutral-600 dark:text-neutral-300">{rest}</span>
          </p>
        )}
        <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-neutral-400">
          {(users.length > 0 || agents.length > 0) && (
            <AvatarStack users={users} agents={agents} size={16} ringClassName="ring-popover" />
          )}
          <span className="min-w-0">
            {e.actorName ?? "Unknown"}
            {e.agentName ? ` via ${e.agentName}` : ""}
            {` · ${formatRelative(e.ts)}`}
            {listName ? ` · ${listName}` : ""}
          </span>
        </p>
        {react && e.reactions && (
          <Reactions
            target={{ type: "activity", id: e.id }}
            reactions={e.reactions}
            viewerId={react.viewerId}
            // Not to your own change: there's nobody to tell.
            canReact={react.canReact && e.actor !== react.viewerId}
            quiet={!react.focused}
            className="mt-1"
          />
        )}
      </div>
    </li>
  );
}

/** Rows grouped under the day they happened, newest day first. */
function byDay<T>(rows: T[], ts: (row: T) => number) {
  const out: { label: string; rows: T[] }[] = [];
  for (const row of rows) {
    const label = dayLabel(ts(row));
    const last = out.at(-1);
    if (last && last.label === label) last.rows.push(row);
    else out.push({ label, rows: [row] });
  }
  return out;
}

/**
 * One comment in the Comments tab, as the item dialog shows it, plus the item
 * it's on (opening it when it's on the board) and, across lists, its list.
 */
function FeedCommentRow({
  comment: c,
  project,
  people,
  showList,
  onOpen,
}: {
  comment: FeedComment;
  project: Pick<Project, "name" | "prefix"> | undefined;
  people: AssigneeView[] | undefined;
  showList: boolean;
  onOpen?: () => void;
}) {
  const ref = project ? formatItemRef(project.prefix, c.item.number) : undefined;
  const item = (
    <>
      {ref && <span className="shrink-0 font-mono text-[11px] text-neutral-400">{ref}</span>}
      <span className="truncate">
        {c.item.completedAt !== null ? (
          <Struck className="[--strike-gap:var(--color-popover)]">{c.item.title}</Struck>
        ) : (
          c.item.title
        )}
      </span>
      {showList && project && (
        <span className="shrink-0 text-neutral-400">· {project.name}</span>
      )}
    </>
  );
  const itemClass = "mt-0.5 flex max-w-full items-center gap-1.5 text-left text-xs text-neutral-500";
  return (
    <CommentCard
      comment={c}
      people={people}
      clamp
      context={
        onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            data-item-ref={ref}
            className={`${itemClass} hover:text-neutral-900 hover:underline dark:hover:text-neutral-100`}
          >
            {item}
          </button>
        ) : (
          <p data-item-ref={ref} className={itemClass}>
            {item}
          </p>
        )
      }
    />
  );
}

export function AuditDialog({
  open,
  projectId,
  projects,
  assigneesByProject = {},
  items = [],
  onOpenItem,
  onClose,
  preview,
}: {
  open: boolean;
  projectId?: string;
  projects: Pick<Project, "id" | "name" | "prefix">[];
  /** Who can open each list's items, for the comments' mentions. */
  assigneesByProject?: Record<string, AssigneeView[]>;
  /** The items the board has, which a comment's item can be opened from. */
  items?: Item[];
  onOpenItem?: (item: Item) => void;
  onClose: () => void;
  /** The landing page's preview: these, newest first, instead of loading them. */
  preview?: { entries: AuditEntryWithActor[]; comments: FeedComment[] };
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [limit, setLimit] = useState(PAGE);
  const [entries, setEntries] = useState<AuditEntryWithActor[]>([]);
  const [comments, setComments] = useState<FeedComment[]>([]);
  const [pending, start] = useTransition();

  // Reset filter + limit when the dialog opens, or when the user switches
  // projects while it stays open. Compare prev props in render rather than
  // syncing via useEffect (avoids cascading renders).
  const [prevOpen, setPrevOpen] = useState(open);
  const [prevProjectId, setPrevProjectId] = useState(projectId);
  if (prevOpen !== open || prevProjectId !== projectId) {
    setPrevOpen(open);
    setPrevProjectId(projectId);
    // Another list's entries never show under this one's name, even if
    // loading this one's fails.
    if (prevProjectId !== projectId) {
      setEntries([]);
      setComments([]);
    }
    if (open) {
      setFilter("all");
      setLimit(PAGE);
    }
  }

  const projectName = useMemo(
    () => projects.find((p) => p.id === projectId)?.name,
    [projects, projectId],
  );
  const nameById = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects],
  );
  const projectById = useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects],
  );
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  // The list, filter and limit the shown entries were loaded with. When a
  // load for the same list fails, the pills and Show more go back to them, so
  // they keep matching the entries and Show more stays there to try again.
  const loaded = useRef({ projectId, filter, limit });

  useEffect(() => {
    if (!open || preview) return;
    let active = true;
    start(async () => {
      // The Comments tab reads the comments; every other tab, the log.
      const read: Promise<() => void> =
        filter === "comments"
          ? listRecentCommentsAction({ projectId, limit }).then(
              (rows) => () => setComments(rows),
            )
          : listAuditAction({
              projectId,
              source: filter === "all" ? undefined : filter,
              limit,
            }).then((rows) => () => setEntries(rows));
      const ok = await runAction(
        read.then(
          (show) => {
            if (!active) return;
            show();
            loaded.current = { projectId, filter, limit };
          },
          // Once the dialog has closed or moved on, a failed load is moot, but a
          // signed-out session's redirect to /login still goes through.
          (error) => {
            unstable_rethrow(error);
            if (active) throw error;
          },
        ),
        filter === "comments" ? "load the comments" : "load the activity",
      );
      if (!ok && loaded.current.projectId === projectId) {
        setFilter(loaded.current.filter);
        setLimit(loaded.current.limit);
      }
    });
    return () => {
      active = false;
    };
  }, [open, projectId, filter, limit, preview]);

  const showingComments = filter === "comments";
  const shownEntries = useMemo(
    () =>
      preview
        ? preview.entries.filter((e) => filter === "all" || e.source === filter)
        : entries,
    [preview, filter, entries],
  );
  const shownComments = preview?.comments ?? comments;
  const groups = useMemo(() => byDay(shownEntries, (e) => e.ts), [shownEntries]);
  const commentGroups = useMemo(
    () => byDay(shownComments, (c) => c.createdAt),
    [shownComments],
  );
  const shownCount = showingComments ? shownComments.length : shownEntries.length;

  // 500 is the most the log or the feed returns, so there's no more to show
  // past it.
  const maybeMore = shownCount === limit && limit < 500;

  return (
    <ResponsiveDialog open={open} onOpenChange={(o) => !o && onClose()}>
      {/* A fixed height, so neither the modal nor the drawer jumps as entries
          load or a filter empties the list. */}
      <ResponsiveDialogContent className="h-[85vh]">
        <div className="flex shrink-0 items-center gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <div className="min-w-0">
            <ResponsiveDialogTitle>Activity</ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="truncate text-left text-xs">
              {projectName ?? "All lists"}
            </ResponsiveDialogDescription>
          </div>
          <ResponsiveDialogCloseButton className="ml-auto shrink-0" />
        </div>

        <div className="flex shrink-0 items-center gap-1 border-b border-neutral-200 p-2 dark:border-neutral-800">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => {
                setLimit(PAGE);
                setFilter(f);
              }}
              className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                filter === f
                  ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                  : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              }`}
            >
              {f}
            </button>
          ))}
          <span className="ml-auto text-xs text-neutral-400">
            {pending ? "…" : `${shownCount}`}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {shownCount === 0 && !pending && (
            <p className="p-6 text-center text-sm text-neutral-400">
              {showingComments ? "No comments yet." : "No activity yet."}
            </p>
          )}
          {showingComments &&
            commentGroups.map((g) => (
              <section key={g.label}>
                <h3 className="sticky top-0 z-10 bg-neutral-50 px-4 py-1.5 text-[11px] font-medium uppercase tracking-wide text-neutral-500 dark:bg-neutral-950">
                  {g.label}
                </h3>
                <ul className="space-y-2 px-4 py-2">
                  {g.rows.map((c) => {
                    const item = itemById.get(c.item.id);
                    return (
                      <FeedCommentRow
                        key={c.id}
                        comment={c}
                        project={projectById.get(c.item.projectId)}
                        people={assigneesByProject[c.item.projectId]}
                        showList={!projectId}
                        onOpen={item && onOpenItem ? () => onOpenItem(item) : undefined}
                      />
                    );
                  })}
                </ul>
              </section>
            ))}
          {!showingComments && groups.map((g) => (
            <section key={g.label}>
              <h3 className="sticky top-0 bg-neutral-50 px-4 py-1.5 text-[11px] font-medium uppercase tracking-wide text-neutral-500 dark:bg-neutral-950">
                {g.label}
              </h3>
              <ul>
                {g.rows.map((e) => (
                  <AuditEntryRow
                    key={e.id}
                    entry={e}
                    listName={
                      !projectId && e.projectId ? nameById.get(e.projectId) : undefined
                    }
                    className="border-b border-neutral-100 px-4 py-2.5 dark:border-neutral-800/60"
                  />
                ))}
              </ul>
            </section>
          ))}

          {maybeMore && (
            <button
              type="button"
              onClick={() => setLimit((l) => Math.min(l + PAGE, 500))}
              disabled={pending}
              className="w-full p-3 text-center text-xs font-medium text-neutral-500 hover:text-neutral-800 disabled:opacity-50 dark:hover:text-neutral-200"
            >
              {pending ? "Loading…" : "Show more"}
            </button>
          )}
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
