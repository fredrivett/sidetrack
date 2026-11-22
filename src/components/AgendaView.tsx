"use client";

import { ChevronDown } from "lucide-react";
import { type ReactNode, useEffect, useId, useOptimistic, useState, useTransition } from "react";
import { flushSync } from "react-dom";
import type { Greeting } from "@/core/agendaGreeting";
import type { AssigneeView } from "@/core/members";
import type { Item, ItemPrLink } from "@/core/schema";
import { formatItemRef } from "@/lib/itemRef";
import { nestItems } from "@/lib/itemTree";
import { AGENDA_SECTIONS, agendaSection, type AgendaSection, weekday } from "@/lib/time";
import { isYours } from "@/lib/filters";
import { useAgendaSaves } from "./agenda-saves";
import { AgendaGreeting } from "./AgendaGreeting";
import { GetStartedStack } from "./GetStarted";
import { PostStack } from "./PostCard";
import type { GetStarted } from "@/lib/getStarted";
import type { FeedbackAbout } from "./FeedbackDialog";
import { ItemDetailDialog, ItemDetailView } from "./ItemDetailDialog";
import { ItemGroupView } from "./ItemList";
import { ItemRow } from "./ItemRow";
import { MoveToTomorrowDialog } from "./MoveToTomorrowDialog";
import type { ProjectView } from "./Kanban";
import { Button } from "./ui/button";
import { ProjectIcon } from "./ProjectIcon";
import { runAction } from "./run-action";
import { useToday } from "./use-day-start";
import { useItemDetailDialog } from "./use-item-detail-dialog";

/** What the Brief reads of a list. */
type AgendaList = Pick<ProjectView, "id" | "name" | "icon" | "homepageUrl" | "refPrefix">;

const openCount = (rows: Item[]) => rows.filter((i) => i.completedAt === null).length;

/** How many of a list's undated items No date shows until asked for the rest. */
const NO_DATE_SHOWN = 10;

/**
 * A section's rows, folding away. Rows 0fr to 1fr animates to the content's
 * own height. Folded, it's inert, so its rows leave the tab order too, and
 * once the fold has closed they unmount: a folded No date with hundreds of
 * items costs nothing to render.
 */
function Fold({ id, collapsed, children }: { id: string; collapsed: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(!collapsed);
  if (!collapsed && !mounted) setMounted(true);
  useEffect(() => {
    if (!collapsed) return;
    // As long as the fold's transition (duration-300).
    const timer = setTimeout(() => setMounted(false), 300);
    return () => clearTimeout(timer);
  }, [collapsed]);
  return (
    <div
      id={id}
      inert={collapsed}
      className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${
        collapsed ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"
      }`}
    >
      {/* -mx-1 px-1 and pb-1 leave room for the rows' focus rings. */}
      <div className="-mx-1 min-h-0 overflow-hidden">
        <div className="space-y-1.5 px-1 pt-0.5 pb-1">{mounted && children}</div>
      </div>
    </div>
  );
}

/**
 * One scroll across every active list, from what's late to what has no date:
 * Overdue, Today, Tomorrow, This week (This weekend on a Saturday or
 * Sunday), Next week, Later, then No date (see agendaSection). Every open
 * item assigned to the viewer or to nobody is on it (isYours), and items
 * finished today stay crossed out in place. Dated sections run by due day, ties keeping board and
 * list order; No date groups its items by list, an undated parent with its
 * undated sub-items under it. Overdue sits in a faint red card the viewer can
 * fold away, which stays folded on every device until they open it again.
 * The header's filters don't apply: it's already only the viewer's, by when
 * it's due, and its greeting reads all of it. A greeting reads the board for the
 * viewer (AgendaGreeting): a sticky column on the left on a wide screen,
 * above the sections on a narrow one.
 */
export function AgendaView({
  projects,
  itemsByProject,
  assigneesByProject,
  prLinksByItem,
  viewerId,
  overdueCollapsed: savedCollapsed,
  noDateCollapsed: savedNoDateCollapsed,
  noDateFoldedLists: savedFoldedLists,
  getStarted,
  greet,
  firstName,
  onFeedback,
  onAddForToday,
  preview,
}: {
  /** Active lists in board order; archived lists stay out. */
  projects: AgendaList[];
  itemsByProject: Record<string, Item[]>;
  assigneesByProject: Record<string, AssigneeView[]>;
  prLinksByItem: Record<string, ItemPrLink[]>;
  viewerId: string;
  /** Whether the viewer keeps Overdue folded away, as saved on their account. */
  overdueCollapsed: boolean;
  /** Whether the viewer keeps No date folded away, as saved on their account. */
  noDateCollapsed: boolean;
  /** The lists whose cards in No date the viewer keeps folded, as saved on their account. */
  noDateFoldedLists: string[];
  /** Where the viewer is with the Get started steps, shown above the sections. */
  /**
   * The Get started stack above the sections, with the lists the viewer can
   * share; absent in the landing page's preview.
   */
  getStarted?: Omit<React.ComponentProps<typeof GetStartedStack>, "state"> & {
    state: GetStarted;
  };
  /** Whether to greet: not before the viewer's timezone is known. */
  greet: boolean;
  /** The viewer's first name, for the greeting's opening line. */
  firstName: string | null;
  /** Opens the feedback form on the greeting; absent where there's no form. */
  onFeedback?: (about: FeedbackAbout) => void;
  /** The greeting's "+" by the date: New item, due today. */
  onAddForToday?: () => void;
  /**
   * The landing page's preview: this greeting instead of asking for one, and
   * `onOpenItem` instead of an item's dialog, which loads from the server.
   */
  preview?: { greeting: Greeting; onOpenItem: (item: Item) => void };
}) {
  const today = useToday();
  const saves = useAgendaSaves();
  // Folds at once, then saves; a failed save unfolds it again with a toast.
  const [overdueCollapsed, showOverdueCollapsed] = useOptimistic(savedCollapsed);
  const [, start] = useTransition();
  const toggleOverdue = () =>
    start(async () => {
      const next = !overdueCollapsed;
      showOverdueCollapsed(next);
      await runAction(
        saves.setOverdueCollapsed(next),
        next ? "collapse Overdue" : "expand Overdue",
      );
    });
  const overdueId = useId();
  const [noDateCollapsed, showNoDateCollapsed] = useOptimistic(savedNoDateCollapsed);
  const toggleNoDate = () =>
    start(async () => {
      const next = !noDateCollapsed;
      showNoDateCollapsed(next);
      await runAction(
        saves.setNoDateCollapsed(next),
        next ? "collapse No date" : "expand No date",
      );
    });
  const noDateId = useId();
  // The lists whose No date card shows all its items, not only the first
  // NO_DATE_SHOWN: for this visit only.
  const [allShown, setAllShown] = useState<ReadonlySet<string>>(new Set());
  // Each list's card in No date folds on its own, the same way.
  const [foldedLists, showListFolded] = useOptimistic(
    savedFoldedLists,
    (lists: string[], { id, folded }: { id: string; folded: boolean }) =>
      folded ? [...lists.filter((l) => l !== id), id] : lists.filter((l) => l !== id),
  );
  const toggleList = (project: AgendaList) =>
    start(async () => {
      const folded = !foldedLists.includes(project.id);
      showListFolded({ id: project.id, folded });
      await runAction(
        saves.setNoDateListFolded(project.id, folded),
        `${folded ? "collapse" : "expand"} ${project.name}`,
      );
    });
  const fold = (id: string, collapsed: boolean, rows: ReactNode) => (
    <Fold id={id} collapsed={collapsed}>
      {rows}
    </Fold>
  );
  const chevron = (collapsed: boolean, size: string) => (
    <ChevronDown
      aria-hidden="true"
      className={`ml-auto ${size} transition-transform duration-300 ease-out motion-reduce:transition-none ${
        collapsed ? "" : "rotate-180"
      }`}
    />
  );
  // The row of the item a greeting chip is hovered or focused on.
  const [lit, setLit] = useState<string | null>(null);
  const lightable = (id: string, row: React.ReactNode) => (
    <div
      key={id}
      data-lit={lit === id || undefined}
      className="rounded-lg transition-shadow duration-200 data-lit:ring-2 data-lit:ring-neutral-300 dark:data-lit:ring-neutral-600"
    >
      {row}
    </div>
  );

  const all = projects.flatMap((p) => itemsByProject[p.id] ?? []);
  const byId = new Map(all.map((i) => [i.id, i]));
  const projectOf = new Map(projects.map((p) => [p.id, p]));
  // Every item, not just those shown, so an open dialog stays open whatever
  // its item becomes.
  const detail = useItemDetailDialog(all);
  const openDetail = preview ? preview.onOpenItem : detail.openDetail;

  const sectionOf = new Map<string, AgendaSection>();
  if (today) {
    for (const i of all) {
      const parent = i.parentId ? byId.get(i.parentId) : undefined;
      // An undated sub-item of a dated parent is planned with it: it shows
      // under the parent, in the parent's section.
      const s = agendaSection(
        !i.dueDate && parent?.dueDate ? { ...i, dueDate: parent.dueDate, dueFrom: parent.dueFrom } : i,
        parent,
        today,
      );
      if (s) sectionOf.set(i.id, s);
    }
  }
  // Items arrive in board order, then list order; a stable sort by due day
  // keeps that order within a day (and leaves No date as it is).
  // Only what's the viewer's: theirs, or nobody's and added by them
  // (isYours), as the greeting reads it.
  const canOpen = (userId: string, projectId: string) =>
    (assigneesByProject[projectId] ?? []).some((a) => a.userId === userId);
  // A sub-item sorts by its parent's day when it has none of its own.
  const dueOf = (i: Item) => i.dueDate ?? (i.parentId ? byId.get(i.parentId)?.dueDate : null) ?? "";
  const onAgenda = all
    .filter(
      (i) =>
        sectionOf.has(i.id) &&
        isYours(i, i.parentId ? byId.get(i.parentId) : undefined, viewerId, canOpen),
    )
    .sort((a, b) => dueOf(a).localeCompare(dueOf(b)));
  const sections = AGENDA_SECTIONS.map(
    (label) => [label, onAgenda.filter((i) => sectionOf.get(i.id) === label)] as const,
  ).filter(([, rows]) => rows.length > 0);

  // The greeting's lighter-day offer: today's open items, as the greeting reads them.
  const [lightenOpen, setLightenOpen] = useState(false);
  const openToday = onAgenda.filter((i) => i.completedAt === null && sectionOf.get(i.id) === "Today");

  const detailProject = detail.item ? projectOf.get(detail.item.projectId) : undefined;
  // What the item's details show, wherever they open.
  const detailProps = (item: Item) => ({
    item,
    parent: (item.parentId && byId.get(item.parentId)) || null,
    checklist: all.filter((i) => i.parentId === item.id),
    // The same rule as the board's dialog (ProjectColumn), within the
    // item's own list.
    nestTargets: all.filter(
      (i) =>
        i.projectId === item.projectId &&
        i.parentId === null &&
        i.completedAt === null &&
        i.id !== item.id,
    ),
    prefix: projectOf.get(item.projectId)?.refPrefix ?? "",
    assignees: assigneesByProject[item.projectId] ?? [],
    viewerId,
    prLinks: prLinksByItem[item.id] ?? [],
  });

  const rowProps = (project: AgendaList | undefined) => ({
    prefix: project?.refPrefix ?? "",
    assignees: project ? (assigneesByProject[project.id] ?? []) : [],
    viewerId,
    prLinksByItem,
    onOpenDetail: openDetail,
  });

  const renderRows = (label: AgendaSection, rows: Item[]) =>
    label === "No date"
      ? projects.map((project) => {
          // A sub-item whose parent the filter hides stays, at the top
          // level, naming its parent (see nestItems).
          const listRows = rows.filter((i) => i.projectId === project.id);
          const groups = nestItems(listRows);
          if (groups.length === 0) return null;
          const row = rowProps(project);
          const folded = foldedLists.includes(project.id);
          const bodyId = `${noDateId}-${project.id}`;
          return (
            // A card per list, so each list's undated items read as one group,
            // and fold away one list at a time.
            <div
              key={project.id}
              className="rounded-xl border border-neutral-200 bg-neutral-50/70 p-1.5 dark:border-neutral-800 dark:bg-neutral-900/40"
            >
              <h3 className="text-xs font-medium">
                <button
                  type="button"
                  onClick={() => toggleList(project)}
                  aria-expanded={!folded}
                  aria-controls={bodyId}
                  className="flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-neutral-600 outline-none hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-neutral-300 dark:text-neutral-300 dark:hover:text-neutral-100 dark:focus-visible:ring-neutral-600"
                >
                  <ProjectIcon
                    icon={project.icon}
                    homepageUrl={project.homepageUrl}
                    name={project.name}
                    size={16}
                  />
                  <span className="truncate">{project.name}</span>
                  <span className="tabular-nums text-neutral-400 dark:text-neutral-500">
                    {openCount(listRows)}
                  </span>
                  {chevron(folded, "size-3.5")}
                </button>
              </h3>
              {fold(bodyId, folded, [
                ...(allShown.has(project.id) ? groups : groups.slice(0, NO_DATE_SHOWN)).map(
                  (group) =>
                    lightable(
                      group.id,
                      group.parentId ? (
                        <ItemRow
                          item={group}
                          prefix={row.prefix}
                          assignees={row.assignees}
                          viewerId={viewerId}
                          prLinks={prLinksByItem[group.id] ?? []}
                          context={byId.get(group.parentId)?.title}
                          onOpenDetail={() => openDetail(group)}
                        />
                      ) : (
                        <ItemGroupView group={group} sortable {...row} />
                      ),
                    ),
                ),
                groups.length > NO_DATE_SHOWN && !allShown.has(project.id) && (
                  <Button
                    key="more"
                    variant="ghost"
                    size="sm"
                    className="w-full text-neutral-500"
                    aria-label={`Show ${groups.length - NO_DATE_SHOWN} more in ${project.name}`}
                    onClick={(e) => {
                      // The button goes as the rest come in: focus moves on to
                      // the first of them, rather than back to the page's top.
                      const lastShown = e.currentTarget.previousElementSibling;
                      flushSync(() => setAllShown((s) => new Set(s).add(project.id)));
                      lastShown?.nextElementSibling
                        ?.querySelector<HTMLElement>("button:not([role=checkbox])")
                        ?.focus();
                    }}
                  >
                    Show {groups.length - NO_DATE_SHOWN} more
                  </Button>
                ),
              ])}
            </div>
          );
        })
      : nestItems(rows).map((item) => {
          const project = projectOf.get(item.projectId);
          const parent = item.parentId ? byId.get(item.parentId) : undefined;
          return lightable(
            item.id,
            item.children.length > 0 ? (
              <ItemGroupView
                group={item}
                list={project}
                // Sorted by day here: only steps due the same day show in
                // their checklist's order, so only they can be reordered.
                sortable={new Set(item.children.map(dueOf)).size === 1}
                {...rowProps(project)}
              />
            ) : (
            <ItemRow
              item={item}
              prefix={project?.refPrefix ?? ""}
              assignees={assigneesByProject[item.projectId] ?? []}
              viewerId={viewerId}
              prLinks={prLinksByItem[item.id] ?? []}
              context={parent?.title}
              list={project}
              onOpenDetail={() => openDetail(item)}
            />
            ),
          );
        });

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Two columns from 900px when greeting: it sticks on the left. */}
      <div
        className={`mx-auto w-full max-w-xl px-3 pt-6 pb-[max(0.75rem,env(safe-area-inset-bottom))] min-[900px]:pt-12 ${
          greet
            ? "min-[900px]:grid min-[900px]:max-w-[68rem] min-[900px]:grid-cols-[minmax(0,24rem)_minmax(0,36rem)] min-[900px]:justify-center min-[900px]:gap-10 min-[1100px]:gap-16"
            : ""
        }`}
      >
        {greet && (
          <aside className="mb-4 min-[900px]:sticky min-[900px]:top-12 min-[900px]:mb-0 min-[900px]:self-start min-[900px]:pt-4">
          <AgendaGreeting
            firstName={firstName}
            itemsById={byId}
            refOf={(item) => formatItemRef(projectOf.get(item.projectId)?.refPrefix ?? "", item.number)}
            onHoverItem={setLit}
            onFeedback={onFeedback}
            onAddForToday={onAddForToday}
            onOpenItem={openDetail}
            greeting={preview?.greeting}
            renderItem={(item, view) => <ItemDetailView {...detailProps(item)} {...view} />}
            onAction={(action) => {
              if (action === "lighten") {
                setLightenOpen(true);
                return;
              }
              // Until there's a triage of its own: open Overdue and go to it.
              if (action !== "triage") return;
              if (overdueCollapsed) toggleOverdue();
              document
                .getElementById(overdueId)
                ?.closest("section")
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          />
          {today && (
            <MoveToTomorrowDialog
              open={lightenOpen}
              onOpenChange={setLightenOpen}
              items={openToday}
              today={today}
              contextOf={(item) => {
                const parent = item.parentId ? byId.get(item.parentId) : undefined;
                return parent?.title ?? projectOf.get(item.projectId)?.name;
              }}
            />
          )}
          <PostStack className="mt-8 hidden min-[900px]:block" />
          </aside>
        )}

        <div className="min-w-0 space-y-4">

        {getStarted && <GetStartedStack {...getStarted} />}

        {today && onAgenda.length === 0 && (
          <p className="py-8 text-center text-sm text-neutral-400">Nothing to do.</p>
        )}

        {sections.map(([label, rows]) =>
          label === "Overdue" ? (
            // A faint red card, in the red of an overdue due chip, so what's late
            // stands apart; -mx-2 keeps its rows in line with the others.
            <section
              key={label}
              className="-mx-2 rounded-2xl border border-red-200/70 bg-red-50/60 px-2 py-1 dark:border-red-900/35 dark:bg-red-950/20"
            >
              <h2 className="text-xs font-medium">
                <button
                  type="button"
                  onClick={toggleOverdue}
                  aria-expanded={!overdueCollapsed}
                  aria-controls={overdueId}
                  className="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left text-red-700 outline-none hover:text-red-800 focus-visible:ring-2 focus-visible:ring-red-300 dark:text-red-400 dark:hover:text-red-300 dark:focus-visible:ring-red-800"
                >
                  {label}
                  <span className="tabular-nums text-red-700/60 dark:text-red-400/60">
                    {openCount(rows)}
                  </span>
                  {chevron(overdueCollapsed, "size-3.5")}
                </button>
              </h2>
              {fold(overdueId, overdueCollapsed, renderRows(label, rows))}
            </section>
          ) : label === "No date" ? (
            // Larger than the dated sections' labels, and folds away: undated
            // items are the backlog, not today's work.
            <section key={label} className="pt-2">
              <h2 className="text-sm font-medium">
                <button
                  type="button"
                  onClick={toggleNoDate}
                  aria-expanded={!noDateCollapsed}
                  aria-controls={noDateId}
                  className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-neutral-700 outline-none hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-neutral-300 dark:text-neutral-300 dark:hover:text-neutral-100 dark:focus-visible:ring-neutral-600"
                >
                  {label}
                  <span className="tabular-nums text-neutral-400 dark:text-neutral-500">
                    {openCount(rows)}
                  </span>
                  {chevron(noDateCollapsed, "size-4")}
                </button>
              </h2>
              {fold(noDateId, noDateCollapsed, renderRows(label, rows))}
            </section>
          ) : (
            <section key={label} className="space-y-1.5">
              {/* Quiet section labels. Counts are what's left. */}
              <h2 className="flex items-center gap-1.5 px-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                {/* At the weekend, what's left of the week is the weekend. */}
                {label === "This week" && today && weekday(today) % 6 === 0 ? "This weekend" : label}
                <span className="tabular-nums text-neutral-400 dark:text-neutral-500">
                  {openCount(rows)}
                </span>
              </h2>
              {renderRows(label, rows)}
            </section>
          ),
        )}
        </div>
      </div>

      {detail.item && detailProject && (
        <ItemDetailDialog
          {...detailProps(detail.item)}
          onOpenItem={detail.goTo}
          history={detail.history}
          open={detail.open}
          onOpenChange={detail.onOpenChange}
        />
      )}
    </div>
  );
}
