"use client";

import { ChevronDown } from "lucide-react";
import { useId, useOptimistic, useState, useTransition } from "react";
import { setOverdueCollapsedAction } from "@/app/actions";
import type { AssigneeView } from "@/core/members";
import type { Item, ItemPrLink } from "@/core/schema";
import { nestItems } from "@/lib/itemTree";
import { AGENDA_SECTIONS, agendaSection, type AgendaSection } from "@/lib/time";
import { isYours, type ItemFilters, matchesFilters } from "@/lib/filters";
import { AgendaGreeting } from "./AgendaGreeting";
import type { FeedbackAbout } from "./FeedbackDialog";
import { ItemDetailDialog } from "./ItemDetailDialog";
import { ItemGroupView } from "./ItemList";
import { ItemRow } from "./ItemRow";
import type { ProjectView } from "./Kanban";
import { ProjectIcon } from "./ProjectIcon";
import { runAction } from "./run-action";
import { useToday } from "./use-day-start";
import { useItemDetailDialog } from "./use-item-detail-dialog";

const openCount = (rows: Item[]) => rows.filter((i) => i.completedAt === null).length;

/**
 * One scroll across every active list, from what's late to what has no date:
 * Overdue, Today, This week, Next week, Later, then No date (see
 * agendaSection). Every open item assigned to the viewer or to nobody is on
 * it (isYours), and items finished today stay
 * crossed out in place. Dated sections run by due day, ties keeping board and
 * list order; No date groups its items by list, an undated parent with its
 * undated sub-items under it. Overdue sits in a faint red card the viewer can
 * fold away, which stays folded on every device until they open it again.
 * The header's filters narrow it. A greeting reads the board for the
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
  greet,
  firstName,
  onFeedback,
  filters,
}: {
  /** Active lists in board order; archived lists stay out. */
  projects: ProjectView[];
  itemsByProject: Record<string, Item[]>;
  assigneesByProject: Record<string, AssigneeView[]>;
  prLinksByItem: Record<string, ItemPrLink[]>;
  viewerId: string;
  /** Whether the viewer keeps Overdue folded away, as saved on their account. */
  overdueCollapsed: boolean;
  /** Whether to greet: not before the viewer's timezone is known. */
  greet: boolean;
  /** The viewer's first name, for the greeting's opening line. */
  firstName: string | null;
  /** Opens the feedback form on the greeting; absent where there's no form. */
  onFeedback?: (about: FeedbackAbout) => void;
  filters: ItemFilters;
}) {
  const today = useToday();
  // Folds at once, then saves; a failed save unfolds it again with a toast.
  const [overdueCollapsed, showOverdueCollapsed] = useOptimistic(savedCollapsed);
  const [, start] = useTransition();
  const toggleOverdue = () =>
    start(async () => {
      const next = !overdueCollapsed;
      showOverdueCollapsed(next);
      await runAction(
        setOverdueCollapsedAction(next),
        next ? "collapse Overdue" : "expand Overdue",
      );
    });
  const overdueId = useId();
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

  const sectionOf = new Map<string, AgendaSection>();
  if (today) {
    for (const i of all) {
      const s = agendaSection(i, i.parentId ? byId.get(i.parentId) : undefined, today);
      if (s) sectionOf.set(i.id, s);
    }
  }
  // Items arrive in board order, then list order; a stable sort by due day
  // keeps that order within a day (and leaves No date as it is).
  // Only what's the viewer's: theirs or nobody's (isYours), as the greeting reads it.
  const onAgenda = all
    .filter((i) => sectionOf.has(i.id) && isYours(i, i.parentId ? byId.get(i.parentId) : undefined, viewerId))
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
  const shown = onAgenda.filter(
    (i) =>
      (filters.doneToday || i.completedAt === null) &&
      matchesFilters(i, i.parentId ? byId.get(i.parentId) : undefined, filters, today),
  );
  const sections = AGENDA_SECTIONS.map(
    (label) => [label, shown.filter((i) => sectionOf.get(i.id) === label)] as const,
  ).filter(([, rows]) => rows.length > 0);

  const detailProject = detail.item ? projectOf.get(detail.item.projectId) : undefined;

  const rowProps = (project: ProjectView | undefined) => ({
    prefix: project?.refPrefix ?? "",
    assignees: project ? (assigneesByProject[project.id] ?? []) : [],
    viewerId,
    prLinksByItem,
    onOpenDetail: detail.openDetail,
  });

  const renderRows = (label: AgendaSection, rows: Item[]) =>
    label === "No date"
      ? projects.map((project) => {
          // A sub-item whose parent the filter hides stays, at the top
          // level, naming its parent (see nestItems).
          const groups = nestItems(rows.filter((i) => i.projectId === project.id));
          if (groups.length === 0) return null;
          const row = rowProps(project);
          return (
            <div key={project.id} className="space-y-1.5 pt-1">
              <h3 className="flex items-center gap-1.5 px-1 text-xs text-neutral-500 dark:text-neutral-400">
                <ProjectIcon
                  icon={project.icon}
                  homepageUrl={project.homepageUrl}
                  name={project.name}
                  size={16}
                />
                <span className="truncate">{project.name}</span>
              </h3>
              {groups.map((group) =>
                lightable(group.id, group.parentId ? (
                  <ItemRow
                    item={group}
                    prefix={row.prefix}
                    assignees={row.assignees}
                    viewerId={viewerId}
                    prLinks={prLinksByItem[group.id] ?? []}
                    context={byId.get(group.parentId)?.title}
                    onOpenDetail={() => detail.openDetail(group)}
                  />
                ) : (
                  <ItemGroupView group={group} {...row} />
                )),
              )}
            </div>
          );
        })
      : rows.map((item) => {
          const project = projectOf.get(item.projectId);
          const parent = item.parentId ? byId.get(item.parentId) : undefined;
          return lightable(
            item.id,
            <ItemRow
              item={item}
              prefix={project?.refPrefix ?? ""}
              assignees={assigneesByProject[item.projectId] ?? []}
              viewerId={viewerId}
              prLinks={prLinksByItem[item.id] ?? []}
              context={[project?.name, parent?.title].filter(Boolean).join(" › ")}
              onOpenDetail={() => detail.openDetail(item)}
            />
          );
        });

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Two columns from 900px when greeting: it sticks on the left. */}
      <div
        className={`mx-auto w-full max-w-xl p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] ${
          greet
            ? "min-[900px]:grid min-[900px]:max-w-5xl min-[900px]:grid-cols-[minmax(0,20rem)_minmax(0,36rem)] min-[900px]:justify-center min-[900px]:gap-10"
            : ""
        }`}
      >
        {greet && (
          <aside className="mb-4 min-[900px]:sticky min-[900px]:top-3 min-[900px]:mb-0 min-[900px]:self-start min-[900px]:pt-4">
          <AgendaGreeting
            firstName={firstName}
            itemsById={byId}
            onHoverItem={setLit}
            onFeedback={onFeedback}
            onOpenItem={detail.openDetail}
            onAction={(action) => {
              // Until there's a triage of its own: open Overdue and go to it.
              if (action !== "triage") return;
              if (overdueCollapsed) toggleOverdue();
              document
                .getElementById(overdueId)
                ?.closest("section")
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          />
          </aside>
        )}

        <div className="min-w-0 space-y-4">

        {today && shown.length === 0 && (
          <p className="py-8 text-center text-sm text-neutral-400">
            {onAgenda.length === 0 ? "Nothing to do." : "Nothing here for your filters."}
          </p>
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
                  <ChevronDown
                    aria-hidden="true"
                    className={`ml-auto size-3.5 transition-transform duration-300 ease-out motion-reduce:transition-none ${
                      overdueCollapsed ? "" : "rotate-180"
                    }`}
                  />
                </button>
              </h2>
              {/* Rows 0fr to 1fr animates to the content's own height. Folded,
                  it's inert, so its rows leave the tab order too. */}
              <div
                id={overdueId}
                inert={overdueCollapsed}
                className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${
                  overdueCollapsed ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"
                }`}
              >
                {/* -mx-1 px-1 and pb-1 leave room for the rows' focus rings. */}
                <div className="-mx-1 min-h-0 overflow-hidden">
                  <div className="space-y-1.5 px-1 pt-0.5 pb-1">{renderRows(label, rows)}</div>
                </div>
              </div>
            </section>
          ) : (
            <section key={label} className="space-y-1.5">
              {/* Quiet section labels. Counts are what's left. */}
              <h2 className="flex items-center gap-1.5 px-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                {label}
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
          item={detail.item}
          parent={all.find((i) => i.id === detail.item?.parentId) ?? null}
          checklist={all.filter((i) => i.parentId === detail.item?.id)}
          // The same rule as the board's dialog (ProjectColumn), within the
          // item's own list.
          nestTargets={all.filter(
            (i) =>
              i.projectId === detail.item?.projectId &&
              i.parentId === null &&
              i.completedAt === null &&
              i.id !== detail.item?.id,
          )}
          onOpenItem={detail.openDetail}
          prefix={detailProject.refPrefix}
          assignees={assigneesByProject[detail.item.projectId] ?? []}
          viewerId={viewerId}
          prLinks={prLinksByItem[detail.item.id] ?? []}
          open={detail.open}
          onOpenChange={detail.onOpenChange}
        />
      )}
    </div>
  );
}
