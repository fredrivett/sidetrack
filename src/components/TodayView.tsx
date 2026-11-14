"use client";

import { useState } from "react";
import type { AssigneeView } from "@/core/members";
import type { Item, ItemPrLink } from "@/core/schema";
import { isOnToday } from "@/lib/time";
import { ItemDetailSheet } from "./ItemDetailSheet";
import { ItemRow } from "./ItemRow";
import type { ProjectView } from "./Kanban";
import { useToday } from "./use-day-start";
import { useItemDetailSheet } from "./use-item-detail-sheet";

const FILTERS = [
  ["all", "All"],
  ["mine", "Mine"],
  ["theirs", "Theirs"],
  ["unassigned", "Unassigned"],
] as const;
type Filter = (typeof FILTERS)[number][0];

/**
 * One list across every active list: items due today or overdue, plus items
 * finished today, crossed out in place (the same rule as list_today, see
 * isOnToday). Overdue first, then by due day; ties keep board and list order.
 */
export function TodayView({
  projects,
  itemsByProject,
  assigneesByProject,
  prLinksByItem,
  viewerId,
}: {
  /** Active lists in board order; paused and archived lists stay out. */
  projects: ProjectView[];
  itemsByProject: Record<string, Item[]>;
  assigneesByProject: Record<string, AssigneeView[]>;
  prLinksByItem: Record<string, ItemPrLink[]>;
  viewerId: string;
}) {
  const today = useToday();
  const [filter, setFilter] = useState<Filter>("all");

  const all = projects.flatMap((p) => itemsByProject[p.id] ?? []);
  const byId = new Map(all.map((i) => [i.id, i]));
  const projectOf = new Map(projects.map((p) => [p.id, p]));
  const detail = useItemDetailSheet(all);

  // Items arrive in board order, then list order; a stable sort by due day
  // keeps that order within a day.
  const onToday = today
    ? all
        .filter((i) => isOnToday(i, today))
        .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))
    : [];
  const matches = (i: Item, f: Filter) =>
    f === "mine"
      ? i.assigneeId === viewerId
      : f === "theirs"
        ? i.assigneeId !== null && i.assigneeId !== viewerId
        : f === "unassigned"
          ? i.assigneeId === null
          : true;
  const shown = onToday.filter((i) => matches(i, filter));
  const sections: Array<[string, Item[]]> = [
    ["Overdue", shown.filter((i) => (i.dueDate ?? "") < (today ?? ""))],
    ["Today", shown.filter((i) => i.dueDate === today)],
  ];

  const detailProject = detail.item ? projectOf.get(detail.item.projectId) : undefined;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-xl space-y-4 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div role="group" aria-label="Whose items" className="flex flex-wrap gap-1">
          {FILTERS.map(([key, label]) => {
            const open = onToday.filter(
              (i) => i.completedAt === null && matches(i, key),
            ).length;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                  filter === key
                    ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                    : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                }`}
              >
                {label}
                {open > 0 && <span className="ml-1 tabular-nums opacity-60">{open}</span>}
              </button>
            );
          })}
        </div>

        {today && shown.length === 0 && (
          <p className="py-8 text-center text-sm text-neutral-400">
            {onToday.length === 0
              ? "Nothing due today. Give an item a due date from its sheet."
              : "Nothing here for this filter."}
          </p>
        )}

        {sections.map(
          ([label, rows]) =>
            rows.length > 0 && (
              <section key={label} className="space-y-1.5">
                {/* Quiet, like a list's "Done (n)": the red due chips already
                    say what's late, so Overdue only gets a dot. */}
                <h2 className="flex items-center gap-1.5 px-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                  {label === "Overdue" && (
                    <span aria-hidden="true" className="size-1.5 rounded-full bg-red-500" />
                  )}
                  {label}
                  <span className="tabular-nums text-neutral-400 dark:text-neutral-500">
                    {rows.length}
                  </span>
                </h2>
                {rows.map((item) => {
                  const project = projectOf.get(item.projectId);
                  const parent = item.parentId ? byId.get(item.parentId) : undefined;
                  return (
                    <ItemRow
                      key={item.id}
                      item={item}
                      prefix={project?.refPrefix ?? ""}
                      assignees={assigneesByProject[item.projectId] ?? []}
                      viewerId={viewerId}
                      prLinks={prLinksByItem[item.id] ?? []}
                      context={[project?.name, parent?.title].filter(Boolean).join(" › ")}
                      onOpenDetail={() => detail.openDetail(item)}
                    />
                  );
                })}
              </section>
            ),
        )}
      </div>

      {detail.item && detailProject && (
        <ItemDetailSheet
          item={detail.item}
          parent={all.find((i) => i.id === detail.item?.parentId) ?? null}
          checklist={all.filter((i) => i.parentId === detail.item?.id)}
          onOpenItem={detail.openDetail}
          prefix={detailProject.prefix}
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
