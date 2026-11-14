"use client";

import { useState } from "react";
import { updateProjectAction } from "@/app/actions";
import type { AssigneeView } from "@/core/members";
import type { Item, ItemPrLink } from "@/core/schema";
import { nestItems } from "@/lib/itemTree";
import { ColumnCard } from "./BoardLayout";
import { DoneSection } from "./DoneSection";
import type { ProjectView } from "./Kanban";
import { EditableText } from "./EditableText";
import { ItemDetailSheet } from "./ItemDetailSheet";
import { ItemList } from "./ItemList";
import { ProjectDetailSheet } from "./ProjectDetailSheet";
import { ProjectIconPicker } from "./ProjectIconPicker";
import { ProjectMenu } from "./ProjectMenu";
import { StatusBadge } from "./StatusBadge";
import { SummaryBlock } from "./SummaryBlock";
import { useDayStart } from "./use-day-start";
import { useItemDetailSheet } from "./use-item-detail-sheet";

export function ProjectColumn({
  project,
  viewerId,
  items,
  assignees,
  prLinksByItem,
  prevId,
  nextId,
  onShowActivity,
  onAddItem,
  onShare,
}: {
  project: ProjectView;
  viewerId: string;
  items: Item[];
  assignees: AssigneeView[];
  prLinksByItem: Record<string, ItemPrLink[]>;
  prevId: string | null;
  nextId: string | null;
  onShowActivity: (projectId: string) => void;
  onAddItem: (projectId: string) => void;
  onShare: (projectId: string, projectName: string) => void;
}) {
  // Items arrive in list order, flat. Group sub-items under their parent; the
  // split below is by the top-level item, and its checklist goes with it.
  // Open items and items finished today share the list (today's crossed out,
  // in place); anything finished before today goes to Done, newest first.
  const dayStart = useDayStart();
  const groups = nestItems(items);
  const active = groups.filter((i) => i.completedAt === null);
  const inList = groups.filter(
    (i) => i.completedAt === null || i.completedAt >= dayStart,
  );
  const done = groups
    .filter((i) => i.completedAt !== null && i.completedAt < dayStart)
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));

  // Lives above the list/done split so it survives an item moving between
  // ItemList and DoneSection when it's reopened or the day turns over — see
  // the hook for the live-lookup / closing-snapshot details.
  const detail = useItemDetailSheet(items);
  // The column re-renders with fresh server props on every edit. It unmounts
  // when the list is deleted, archived, or moves between the active and paused
  // groups (Kanban renders those as separate arrays), which resets this local
  // state; plain open-state is still enough — no live-lookup/closing-snapshot
  // dance like the item sheet needs.
  const [detailsOpen, setDetailsOpen] = useState(false);
  // A paused list sits collapsed at the end of the board until opened.
  const [showPaused, setShowPaused] = useState(false);
  const collapsed = project.status === "paused" && !showPaused;

  return (
    <ColumnCard
      data-project-id={project.id}
      header={
        <>
          {/* Icon, title row and ⋯ menu are all 32px tall so they line up. */}
          <ProjectIconPicker project={project} size={24} />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-1">
              {/* The button and the input share height, padding and border, and
                  the input sizes to its text, so editing doesn't shift layout. */}
              <EditableText
                value={project.name}
                onSave={(next) =>
                  updateProjectAction(project.id, { name: next })
                }
                required
                className="h-8 min-w-0 cursor-text truncate rounded-md border border-transparent px-1.5 text-base font-semibold transition-colors hover:bg-muted"
                inputClassName="field-sizing-content h-8 min-w-0 px-1.5 py-0 text-base font-semibold"
              />
              <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                {project.prefix}
              </span>
            </div>
            {(project.status !== "active" || !project.isOwner) && (
              <div className="flex items-center gap-1.5">
                {project.status !== "active" && (
                  <StatusBadge
                    projectId={project.id}
                    status={project.status}
                  />
                )}
                {!project.isOwner && (
                  <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-700 dark:bg-sky-950 dark:text-sky-400">
                    Shared
                  </span>
                )}
              </div>
            )}
          </div>
          <ProjectMenu
            projectId={project.id}
            prevId={prevId}
            nextId={nextId}
            name={project.name}
            prefix={project.prefix}
            status={project.status}
            isOwner={project.isOwner}
            onShowActivity={onShowActivity}
            onShowDetails={() => setDetailsOpen(true)}
            onAddItem={onAddItem}
            onShare={onShare}
          />
        </>
      }
    >
      {collapsed ? (
        <div className="space-y-1 py-1 text-sm text-neutral-500">
          <p>
            {active.length} open item{active.length === 1 ? "" : "s"}, set
            aside for now.
          </p>
          <button
            type="button"
            onClick={() => setShowPaused(true)}
            className="text-xs font-medium hover:text-neutral-700 dark:hover:text-neutral-300"
          >
            Show items
          </button>
        </div>
      ) : (
        <>
          {project.status === "paused" && (
            <button
              type="button"
              onClick={() => setShowPaused(false)}
              className="mb-2 text-xs font-medium text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
            >
              Hide items
            </button>
          )}
          <SummaryBlock
            projectId={project.id}
            summary={project.summary}
            summaryUpdatedAt={project.summaryUpdatedAt}
          />

          <div className="space-y-3 pt-3">
            <ItemList
              projectId={project.id}
              groups={inList}
              prefix={project.refPrefix}
              assignees={assignees}
              viewerId={viewerId}
              prLinksByItem={prLinksByItem}
              onOpenDetail={detail.openDetail}
            />
            {done.length > 0 && (
              <DoneSection
                groups={done}
                prefix={project.refPrefix}
                assignees={assignees}
                viewerId={viewerId}
                prLinksByItem={prLinksByItem}
                onOpenDetail={detail.openDetail}
              />
            )}
          </div>
        </>
      )}
      {detail.item && (
        <ItemDetailSheet
          item={detail.item}
          parent={items.find((i) => i.id === detail.item?.parentId) ?? null}
          checklist={items.filter((i) => i.parentId === detail.item?.id)}
          nestTargets={items.filter(
            (i) =>
              i.kind === "task" &&
              i.parentId === null &&
              i.completedAt === null &&
              i.id !== detail.item?.id,
          )}
          onOpenItem={detail.openDetail}
          prefix={project.prefix}
          assignees={assignees}
          viewerId={viewerId}
          prLinks={prLinksByItem[detail.item.id] ?? []}
          open={detail.open}
          onOpenChange={detail.onOpenChange}
        />
      )}

      <ProjectDetailSheet
        project={project}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
      />
    </ColumnCard>
  );
}
