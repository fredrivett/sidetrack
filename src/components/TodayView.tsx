"use client";

import { useState } from "react";
import type { AssigneeView } from "@/core/members";
import type { Item, ItemPrLink } from "@/core/schema";
import { isOnToday } from "@/lib/time";
import { matchesWhose, type WhoseFilter } from "@/lib/whose";
import { ItemDetailSheet } from "./ItemDetailSheet";
import { ItemRow } from "./ItemRow";
import type { ProjectView } from "./Kanban";
import { useToday } from "./use-day-start";
import { useItemDetailSheet } from "./use-item-detail-sheet";
import { WhoseFilterBar } from "./WhoseFilterBar";

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
  const [filter, setFilter] = useState<WhoseFilter>("all");

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
  const shown = onToday.filter((i) => matchesWhose(i, filter, viewerId));
  const sections: Array<[string, Item[]]> = [
    ["Overdue", shown.filter((i) => (i.dueDate ?? "") < (today ?? ""))],
    ["Today", shown.filter((i) => i.dueDate === today)],
  ];

  const detailProject = detail.item ? projectOf.get(detail.item.projectId) : undefined;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-xl space-y-4 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <WhoseFilterBar
          value={filter}
          onChange={setFilter}
          count={(f) =>
            onToday.filter((i) => i.completedAt === null && matchesWhose(i, f, viewerId))
              .length
          }
        />

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
          // The same rule as the board's sheet (ProjectColumn), within the
          // item's own list.
          nestTargets={all.filter(
            (i) =>
              i.projectId === detail.item?.projectId &&
              i.parentId === null &&
              i.completedAt === null &&
              i.id !== detail.item?.id,
          )}
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
