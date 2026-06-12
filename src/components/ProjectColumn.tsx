"use client";

import { useState } from "react";
import { updateProjectAction } from "@/app/actions";
import type { Item, ItemPrLink } from "@/core/schema";
import { CompletedSection } from "./CompletedSection";
import type { ProjectView } from "./Kanban";
import { EditableText } from "./EditableText";
import { ItemDetailSheet } from "./ItemDetailSheet";
import { ItemList } from "./ItemList";
import { ProjectDetailSheet } from "./ProjectDetailSheet";
import { ProjectIconPicker } from "./ProjectIconPicker";
import { ProjectMenu } from "./ProjectMenu";
import { StatusBadge } from "./StatusBadge";
import { SummaryBlock } from "./SummaryBlock";
import { useItemDetailSheet } from "./use-item-detail-sheet";

export function ProjectColumn({
  project,
  items,
  prLinksByItem,
  prevId,
  nextId,
  onShowActivity,
  onAddItem,
  onShare,
}: {
  project: ProjectView;
  items: Item[];
  prLinksByItem: Record<string, ItemPrLink[]>;
  prevId: string | null;
  nextId: string | null;
  onShowActivity: (projectId: string) => void;
  onAddItem: (projectId: string) => void;
  onShare: (projectId: string, projectName: string) => void;
}) {
  const completed = items.filter((i) => i.completedAt !== null);
  const active = items.filter((i) => i.completedAt === null);

  // Lives above the active/completed split so it survives an item moving
  // between ItemList and CompletedSection when it's (un)completed — see the
  // hook for the live-lookup / closing-snapshot details.
  const detail = useItemDetailSheet(items);
  // The column re-renders with fresh server props on every edit and only
  // unmounts when the project is deleted, so plain open-state is enough — no
  // live-lookup/closing-snapshot dance like the item sheet needs.
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    <article
      data-project-id={project.id}
      className="flex h-full snap-center shrink-0 flex-col gap-3 overflow-hidden rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 w-[92vw] sm:w-80"
    >
      <header className="flex items-start gap-2 shrink-0">
        <ProjectIconPicker project={project} size={22} />
        <div className="min-w-0 flex-1 space-y-1">
          <EditableText
            value={project.name}
            onSave={(next) => updateProjectAction(project.id, { name: next })}
            required
            className="block w-full truncate text-base font-semibold"
            inputClassName="w-full text-base font-semibold"
          />
          <div className="flex items-center gap-1.5">
            <StatusBadge projectId={project.id} status={project.status} />
            <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
              {project.prefix}
            </span>
            {!project.isOwner && (
              <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-700 dark:bg-sky-950 dark:text-sky-400">
                Shared
              </span>
            )}
          </div>
        </div>
        <ProjectMenu
          projectId={project.id}
          prevId={prevId}
          nextId={nextId}
          name={project.name}
          prefix={project.prefix}
          isOwner={project.isOwner}
          onShowActivity={onShowActivity}
          onShowDetails={() => setDetailsOpen(true)}
          onAddItem={onAddItem}
          onShare={onShare}
        />
      </header>

      <div className="flex-1 min-h-0 -mx-3 overflow-y-auto px-3">
        <SummaryBlock
          projectId={project.id}
          summary={project.summary}
          summaryUpdatedAt={project.summaryUpdatedAt}
        />

        <div className="space-y-3 pt-3">
          <CompletedSection
            items={completed}
            prefix={project.refPrefix}
            prLinksByItem={prLinksByItem}
            onOpenDetail={detail.openDetail}
          />
          <ItemList
            projectId={project.id}
            items={active}
            prefix={project.refPrefix}
            prLinksByItem={prLinksByItem}
            onOpenDetail={detail.openDetail}
          />
        </div>
      </div>

      {detail.item && (
        <ItemDetailSheet
          item={detail.item}
          prefix={project.prefix}
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
    </article>
  );
}
