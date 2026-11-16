"use client";

import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { useState } from "react";
import { updateProjectAction } from "@/app/actions";
import type { AssigneeView } from "@/core/members";
import type { Item, ItemPrLink } from "@/core/schema";
import type { SpaceView } from "@/core/spaces";
import { nestItems } from "@/lib/itemTree";
import { startOfWeek } from "@/lib/time";
import { ColumnCard } from "./BoardLayout";
import { DoneSection } from "./DoneSection";
import type { ProjectView } from "./Kanban";
import { EditableText } from "./EditableText";
import { ItemDetailDialog } from "./ItemDetailDialog";
import { DraggableItemList } from "./ItemList";
import { ProjectDetailDialog } from "./ProjectDetailDialog";
import { ProjectIconPicker, useListIcon } from "./ProjectIconPicker";
import { ProjectMenu } from "./ProjectMenu";
import { StatusBadge } from "./StatusBadge";
import { SummaryBlock } from "./SummaryBlock";
import { useCollapsedItems } from "./use-collapsed-items";
import { useDayStart } from "./use-day-start";
import { useItemDetailDialog } from "./use-item-detail-dialog";
import { runAction } from "./run-action";
import { ListSaveContext, useNewListSave } from "./use-list-saves";

export function ProjectColumn({
  project,
  viewerId,
  items,
  assignees,
  prLinksByItem,
  prevId,
  nextId,
  firstId,
  lastId,
  onShowActivity,
  onAddItem,
  onShare,
  spaces,
}: {
  project: ProjectView;
  viewerId: string;
  items: Item[];
  assignees: AssigneeView[];
  prLinksByItem: Record<string, ItemPrLink[]>;
  prevId: string | null;
  nextId: string | null;
  firstId: string;
  lastId: string;
  onShowActivity: (projectId: string) => void;
  onAddItem: (projectId: string) => void;
  onShare: (projectId: string, projectName: string) => void;
  spaces: SpaceView[];
}) {
  // Items arrive in list order, flat. Group sub-items under their parent; the
  // split below is by the top-level item, and its checklist goes with it.
  // Open items and items finished today share the list (today's crossed out,
  // in place); anything finished earlier this week goes to Done, newest
  // first, and older ones leave the board. Before the browser knows its day
  // (dayStart is Infinity), Done shows every finished item the server sent.
  const dayStart = useDayStart();
  // A list in one of the viewer's Spaces sits on that Space's tray, which
  // already says who shares it, so it drops the "Shared" badge.
  const inSpace = spaces.some((s) => s.id === project.spaceId);
  const weekStart = Number.isFinite(dayStart) ? startOfWeek(dayStart) : -Infinity;
  const groups = nestItems(items);
  const active = groups.filter((i) => i.completedAt === null);
  const inList = groups.filter(
    (i) => i.completedAt === null || i.completedAt >= dayStart,
  );
  const done = groups
    .filter(
      (i) =>
        i.completedAt !== null &&
        i.completedAt < dayStart &&
        i.completedAt >= weekStart,
    )
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));

  // Lives above the list/done split so it survives an item moving between
  // DraggableItemList and DoneSection when it's reopened or the day turns
  // over — see the hook for the live-lookup / closing-snapshot details.
  const detail = useItemDetailDialog(items);
  // The column re-renders with fresh server props on every edit, and stays
  // mounted when the list is paused or resumed (Kanban keys every column in
  // one array), so the dialog stays open across a status change. It unmounts
  // when the list is deleted, left, archived or moved to another Space's
  // tray, which closes it; plain open-state is enough — no
  // live-lookup/closing-snapshot dance like the item dialog needs.
  const [detailsOpen, setDetailsOpen] = useState(false);
  // A paused list sits collapsed at the end of the board until opened.
  const [showPaused, setShowPaused] = useState(false);
  const collapsed = project.status === "paused" && !showPaused;
  // Parents in the list whose sub-items are hidden. Kept here, not in
  // DraggableItemList, so the header's button can collapse or expand them all
  // at once; it shows only while the list has a parent with sub-items on view.
  const { collapsed: collapsedItems, setCollapsed } = useCollapsedItems(items);
  const parents = inList.filter((g) => g.children.length > 0).map((g) => g.id);
  const allCollapsed = parents.every((id) => collapsedItems.has(id));
  // The list's held saves (status, order, prefix, icon…) dim the whole column
  // until they land, whichever control started them.
  const listSave = useNewListSave();
  const listIcon = useListIcon(project);

  return (
    <ListSaveContext value={listSave}>
    <ColumnCard
      data-project-id={project.id}
      aria-busy={listSave.saving || undefined}
      style={{ opacity: listSave.saving ? 0.7 : 1 }}
      header={
        <>
          {/* Icon, title row and ⋯ menu are all 32px tall so they line up. */}
          <ProjectIconPicker project={project} listIcon={listIcon} size={24} />
          <div className="min-w-0 flex-1 space-y-1">
            {/* -ml-[7px] cancels the title's border + padding so its text sits
                where it would without the hover box, close to the icon. */}
            <div className="-ml-[7px] flex items-center gap-1">
              {/* The button and the input share height, padding and border, and
                  the input sizes to its text, so editing doesn't shift layout. */}
              <EditableText
                value={project.name}
                onSave={(next) =>
                  runAction(
                    updateProjectAction(project.id, listIcon.rename(next)),
                    `rename “${project.name}”`,
                  )
                }
                onDraftChange={listIcon.onDraftChange}
                required
                className="h-8 min-w-0 cursor-text truncate rounded-md border border-transparent px-1.5 text-base font-semibold transition-colors hover:bg-muted"
                inputClassName="field-sizing-content h-8 min-w-0 px-1.5 py-0 text-base font-semibold"
              />
              <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                {project.prefix}
              </span>
            </div>
            {(project.status !== "active" || (!project.isOwner && !inSpace)) && (
              <div className="flex items-center gap-1.5">
                {project.status !== "active" && (
                  <StatusBadge
                    projectId={project.id}
                    status={project.status}
                  />
                )}
                {!project.isOwner && !inSpace && (
                  <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-700 dark:bg-sky-950 dark:text-sky-400">
                    Shared
                  </span>
                )}
              </div>
            )}
          </div>
          {!collapsed && parents.length > 0 && (
            <button
              type="button"
              aria-label={allCollapsed ? "Expand all sub-items" : "Collapse all sub-items"}
              title={allCollapsed ? "Expand all" : "Collapse all"}
              onClick={() =>
                // Only the parents on view, so one in Done keeps its state if
                // it comes back to the list.
                setCollapsed(parents, !allCollapsed)
              }
              className="-mr-1.5 flex h-8 items-center rounded px-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              {allCollapsed ? (
                <ChevronsUpDown className="size-4" />
              ) : (
                <ChevronsDownUp className="size-4" />
              )}
            </button>
          )}
          <ProjectMenu
            projectId={project.id}
            prevId={prevId}
            nextId={nextId}
            firstId={firstId}
            lastId={lastId}
            name={project.name}
            prefix={project.prefix}
            status={project.status}
            isOwner={project.isOwner}
            spaceId={project.spaceId}
            spaces={spaces}
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
          {/* Only shown once written; an empty summary is added from the
              details dialog, so it doesn't take up room on every card. */}
          {project.summary.trim() && (
            <SummaryBlock
              projectId={project.id}
              summary={project.summary}
              summaryUpdatedAt={project.summaryUpdatedAt}
            />
          )}

          <div className="space-y-3 pt-1.5">
            <DraggableItemList
              projectId={project.id}
              groups={inList}
              collapsed={collapsedItems}
              onToggleCollapsed={(id) =>
                setCollapsed([id], !collapsedItems.has(id))
              }
              prefix={project.refPrefix}
              assignees={assignees}
              viewerId={viewerId}
              prLinksByItem={prLinksByItem}
              onOpenDetail={detail.openDetail}
              onAddItem={() => onAddItem(project.id)}
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
        <ItemDetailDialog
          item={detail.item}
          parent={items.find((i) => i.id === detail.item?.parentId) ?? null}
          checklist={items.filter((i) => i.parentId === detail.item?.id)}
          nestTargets={items.filter(
            (i) =>
              i.parentId === null &&
              i.completedAt === null &&
              i.id !== detail.item?.id,
          )}
          onOpenItem={detail.openDetail}
          prefix={project.refPrefix}
          assignees={assignees}
          viewerId={viewerId}
          prLinks={prLinksByItem[detail.item.id] ?? []}
          open={detail.open}
          onOpenChange={detail.onOpenChange}
        />
      )}

      <ProjectDetailDialog
        project={project}
        isAdmin={
          project.isOwner ||
          spaces.some((s) => s.id === project.spaceId && s.role === "admin")
        }
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
      />
    </ColumnCard>
    </ListSaveContext>
  );
}
