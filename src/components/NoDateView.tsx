"use client";

import { useState } from "react";
import type { AssigneeView } from "@/core/members";
import type { Item, ItemPrLink } from "@/core/schema";
import { nestItems } from "@/lib/itemTree";
import { isOnNoDate } from "@/lib/time";
import { matchesWhose, type WhoseFilter } from "@/lib/whose";
import { ItemDetailSheet } from "./ItemDetailSheet";
import { ItemGroupView } from "./ItemList";
import { ItemRow } from "./ItemRow";
import type { ProjectView } from "./Kanban";
import { ProjectIcon } from "./ProjectIcon";
import { useToday } from "./use-day-start";
import { useItemDetailSheet } from "./use-item-detail-sheet";
import { WhoseFilterBar } from "./WhoseFilterBar";

/**
 * Every active list's tasks with no due date, one section per list in board
 * order, items in list order, for planning when to do them (the same rule as
 * list_no_date, see isOnNoDate). An undated parent shows its undated
 * sub-items under it; a dated parent's checklist is planned with it, so stays
 * out. Giving an item a date takes it off this view; finishing one leaves it
 * crossed out until tomorrow, as in the lists.
 */
export function NoDateView({
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
  // Every item, not just the undated ones, so an open sheet stays open once
  // it gives its item a date.
  const detail = useItemDetailSheet(all);

  const undated = today
    ? all.filter((i) =>
        isOnNoDate(i, i.parentId ? byId.get(i.parentId) : undefined, today),
      )
    : [];
  const sections = projects
    .map((project) => ({
      project,
      // A sub-item whose parent the filter hides stays, at the top level,
      // naming its parent (see nestItems).
      groups: nestItems(
        undated.filter(
          (i) => i.projectId === project.id && matchesWhose(i, filter, viewerId),
        ),
      ),
    }))
    .filter((s) => s.groups.length > 0);

  const detailProject = detail.item
    ? projects.find((p) => p.id === detail.item?.projectId)
    : undefined;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-xl space-y-4 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <WhoseFilterBar
          value={filter}
          onChange={setFilter}
          count={(f) =>
            undated.filter((i) => i.completedAt === null && matchesWhose(i, f, viewerId))
              .length
          }
        />

        {today && sections.length === 0 && (
          <p className="py-8 text-center text-sm text-neutral-400">
            {undated.length === 0
              ? "Everything has a date."
              : "Nothing here for this filter."}
          </p>
        )}

        {sections.map(({ project, groups }) => {
          const row = {
            prefix: project.refPrefix,
            assignees: assigneesByProject[project.id] ?? [],
            viewerId,
            prLinksByItem,
            onOpenDetail: detail.openDetail,
          };
          const open = groups
            .flatMap((g) => [g, ...g.children])
            .filter((i) => i.completedAt === null).length;
          return (
            <section key={project.id} className="space-y-1.5">
              <h2 className="flex items-center gap-1.5 px-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                <ProjectIcon
                  icon={project.icon}
                  homepageUrl={project.homepageUrl}
                  name={project.name}
                  size={16}
                />
                <span className="truncate">{project.name}</span>
                <span className="tabular-nums text-neutral-400 dark:text-neutral-500">
                  {open}
                </span>
              </h2>
              {groups.map((group) =>
                group.parentId ? (
                  <ItemRow
                    key={group.id}
                    item={group}
                    prefix={row.prefix}
                    assignees={row.assignees}
                    viewerId={viewerId}
                    prLinks={prLinksByItem[group.id] ?? []}
                    context={byId.get(group.parentId)?.title}
                    onOpenDetail={() => detail.openDetail(group)}
                  />
                ) : (
                  <ItemGroupView key={group.id} group={group} {...row} />
                ),
              )}
            </section>
          );
        })}
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
