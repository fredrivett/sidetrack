"use client";

import { Check, ChevronsDownUp, ChevronsUpDown, Plus } from "lucide-react";
import { type ReactNode, useState } from "react";
import { updateProjectAction } from "@/app/actions";
import type { AssigneeView } from "@/core/members";
import type { Item, ItemPrLink } from "@/core/schema";
import type { SpaceView } from "@/core/spaces";
import { filtersByDue, type ItemFilters, matchesFilters, shownInGroups } from "@/lib/filters";
import { nestItems } from "@/lib/itemTree";
import { ColumnCard } from "./BoardLayout";
import type { ProjectView } from "./Kanban";
import { EditableText } from "./EditableText";
import { ItemDetailDialog } from "./ItemDetailDialog";
import { DraggableItemList, ItemGroupView } from "./ItemList";
import { ProjectDetailDialog } from "./ProjectDetailDialog";
import { ProjectIconPicker, useListIcon } from "./ProjectIconPicker";
import { ProjectMenu } from "./ProjectMenu";
import { StatusBadge } from "./StatusBadge";
import { SummaryBlock } from "./SummaryBlock";
import { useCollapsedItems } from "./use-collapsed-items";
import { useListBounds, useToday } from "./use-day-start";
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
  filters,
  aiEnabled,
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
  filters: ItemFilters;
  aiEnabled: boolean;
}) {
  // Items arrive in list order, flat. Group sub-items under their parent; the
  // split below is by the top-level item, and its checklist goes with it.
  // Open items and items finished today share the list (today's crossed out,
  // in place); anything finished earlier this week goes to Done, newest
  // first, and older ones leave the board. Before the browser knows its day,
  // the split uses the server's guess at it (useListBounds). The viewer's
  // filters can send today's to Done straight away, and leave Done out.
  const { dayStart, weekStart } = useListBounds();
  // A list in one of the viewer's Spaces sits on that Space's tray, which
  // already says who shares it, so it drops the "Shared" badge.
  const inSpace = spaces.some((s) => s.id === project.spaceId);
  const today = useToday();
  // "Tidy done items" in the list's menu moves today's early too.
  const doneBefore = Math.max(dayStart, project.doneClearedAt ?? -Infinity);
  const groups = nestItems(items);
  const active = groups.filter((i) => i.completedAt === null);
  const inList = groups.filter(
    (i) =>
      i.completedAt === null || (filters.doneToday && i.completedAt >= doneBefore),
  );
  const done = filters.doneThisWeek
    ? groups
        .filter(
          (i) =>
            i.completedAt !== null && !inList.includes(i) && i.completedAt >= weekStart,
        )
        .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
    : [];
  // The rows the filters leave, kept as ids so the list still knows every
  // item's real place and checklist: a drag lands among the rows on view, and
  // an item with hidden sub-items still can't become one.
  const shownInList = shownInGroups(
    inList,
    (i, parent) =>
      (filters.doneToday || i.completedAt === null) &&
      matchesFilters(i, parent, filters, today),
  );
  const shownDone = shownInGroups(done, (i, parent) => matchesFilters(i, parent, filters, today));
  const doneShown = done.filter((g) => shownDone.has(g.id));
  // The header's badge swaps the list for these, and shows only for more than
  // one. Derived, so the list comes back by itself when they drop to one.
  const [showDoneChoice, setShowDone] = useState(false);
  const hasDoneBadge = doneShown.length > 1;
  const showDone = showDoneChoice && hasDoneBadge;
  // Set by the first click, so the swap animates but the board's first
  // render doesn't.
  const [swapped, setSwapped] = useState(false);
  // Due filters wait for the browser's day (see matchesFilters), so the list
  // doesn't say nothing matches before it knows.
  const waiting = today === null && filtersByDue(filters);

  // Lives above the list/done split so it survives an item moving between
  // the list and Done this week when it's reopened or the day turns
  // over — see the hook for the live-lookup / closing-snapshot details.
  const detail = useItemDetailDialog(items);
  // The column re-renders with fresh server props on every edit. It unmounts
  // when the list is deleted, left, archived, restored or moved to another
  // Space's tray, which closes it; plain open-state is enough — no
  // live-lookup/closing-snapshot dance like the item dialog needs.
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Parents in the list whose sub-items are hidden. Kept here, not in
  // DraggableItemList, so the header's button can collapse or expand them all
  // at once; it shows only while the list has a parent with sub-items on view.
  const { collapsed: collapsedItems, setCollapsed } = useCollapsedItems(items);
  const parents = inList
    .filter((g) => g.children.length > 0 && shownInList.has(g.id))
    .map((g) => g.id);
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
            </div>
            {(project.status !== "active" || (!project.isOwner && !inSpace)) && (
              <div className="flex items-center gap-1.5">
                {project.status !== "active" && (
                  <StatusBadge status={project.status} />
                )}
                {!project.isOwner && !inSpace && (
                  <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-700 dark:bg-sky-950 dark:text-sky-400">
                    Shared
                  </span>
                )}
              </div>
            )}
          </div>
          <HeaderSlot show={hasDoneBadge}>
            <button
              type="button"
              aria-pressed={showDone}
              aria-label={`${doneShown.length} done this week`}
              title={showDone ? "Back to the list" : "Done this week"}
              onClick={() => {
                setShowDone(!showDone);
                setSwapped(true);
              }}
              className={`mt-1 flex h-6 shrink-0 items-center gap-0.5 rounded-full px-2 text-xs font-medium tabular-nums transition-colors ${
                showDone
                  ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                  : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700"
              }`}
            >
              <Check className="size-3.5" />
              {doneShown.length}
            </button>
          </HeaderSlot>
          <HeaderSlot show={parents.length > 0 && !showDone}>
            <button
              type="button"
              aria-label={allCollapsed ? "Expand all sub-items" : "Collapse all sub-items"}
              title={allCollapsed ? "Expand all" : "Collapse all"}
              onClick={() =>
                // Only the parents on view, so one in Done keeps its state if
                // it comes back to the list.
                setCollapsed(parents, !allCollapsed)
              }
              className="flex h-8 items-center rounded px-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              {allCollapsed ? (
                <ChevronsUpDown className="size-4" />
              ) : (
                <ChevronsDownUp className="size-4" />
              )}
            </button>
          </HeaderSlot>
          {/* 32px between its centre and the ⋯'s, as between the Space
              tray's + and ⋯, so in a tray's last list they line up. */}
          <button
            type="button"
            aria-label={`Add item to ${project.name}`}
            title="Add item"
            onClick={() => onAddItem(project.id)}
            className="flex h-8 items-center rounded px-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <Plus className="size-4" />
          </button>
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
            doneInList={inList.length - active.length}
            onShowActivity={onShowActivity}
            onShowDetails={() => setDetailsOpen(true)}
            onAddItem={onAddItem}
            onShare={onShare}
            aiEnabled={aiEnabled}
          />
        </>
      }
    >
      {/* Only shown once written; an empty summary is added from the
          details dialog, so it doesn't take up room on every card. */}
      {project.summary.trim() && (
        <SummaryBlock
          projectId={project.id}
          summary={project.summary}
          summaryUpdatedAt={project.summaryUpdatedAt}
        />
      )}

      {/* Keyed by what it shows, so each swap mounts it afresh and slides in:
          Done this week from the badge's side, the list back from the other. */}
      <div
        key={showDone ? "done" : "list"}
        className={`space-y-3 pt-1.5 ${
          swapped
            ? `motion-safe:animate-[slide-in_250ms_cubic-bezier(0.2,0.8,0.2,1)] ${
                showDone ? "[--slide-from:16px_0]" : "[--slide-from:-16px_0]"
              }`
            : ""
        }`}
      >
        {showDone ? (
          <section className="space-y-1.5">
            <h3 className="text-xs font-medium text-neutral-500">Done this week</h3>
            {doneShown.map((g) => (
              <ItemGroupView
                key={g.id}
                group={g}
                shown={shownDone}
                prefix={project.refPrefix}
                assignees={assignees}
                viewerId={viewerId}
                prLinksByItem={prLinksByItem}
                onOpenDetail={detail.openDetail}
              />
            ))}
          </section>
        ) : (
          !waiting && <DraggableItemList
            projectId={project.id}
            groups={inList}
            shown={shownInList}
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
        )}
      </div>
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
          onOpenItem={detail.goTo}
          history={detail.history}
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

/**
 * A header button that folds away rather than popping out: its width eases
 * to nothing, taking the header's gap with it, and it fades. It stays
 * mounted, inert while folded, so the change can animate both ways.
 */
function HeaderSlot({ show, children }: { show: boolean; children: ReactNode }) {
  return (
    <div
      aria-hidden={!show || undefined}
      inert={!show}
      className={`grid shrink-0 transition-[grid-template-columns,margin,opacity] duration-200 ease-out motion-reduce:transition-none ${
        show ? "grid-cols-[1fr] opacity-100" : "-ml-2 grid-cols-[0fr] opacity-0"
      }`}
    >
      <div className="min-w-0 overflow-hidden">{children}</div>
    </div>
  );
}
