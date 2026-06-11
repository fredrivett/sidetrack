"use client";

import { updateProjectAction } from "@/app/actions";
import type { Item, ItemPrLink, Project } from "@/core/schema";
import { CompletedSection } from "./CompletedSection";
import { EditableText } from "./EditableText";
import { ItemDetailSheet } from "./ItemDetailSheet";
import { ItemList } from "./ItemList";
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
}: {
  project: Project;
  items: Item[];
  prLinksByItem: Record<string, ItemPrLink[]>;
  prevId: string | null;
  nextId: string | null;
  onShowActivity: (projectId: string) => void;
  onAddItem: (projectId: string) => void;
}) {
  const completed = items.filter((i) => i.completedAt !== null);
  const active = items.filter((i) => i.completedAt === null);

  // Lives above the active/completed split so it survives an item moving
  // between ItemList and CompletedSection when it's (un)completed — see the
  // hook for the live-lookup / closing-snapshot details.
  const detail = useItemDetailSheet(items);

  return (
    <article
      data-project-id={project.id}
      className="flex h-full snap-center shrink-0 flex-col gap-3 overflow-hidden rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 w-[92vw] sm:w-80"
    >
      <header className="flex items-start gap-2 shrink-0">
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
          </div>
        </div>
        <ProjectMenu
          projectId={project.id}
          prevId={prevId}
          nextId={nextId}
          name={project.name}
          prefix={project.prefix}
          onShowActivity={onShowActivity}
          onAddItem={onAddItem}
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
            prefix={project.prefix}
            prLinksByItem={prLinksByItem}
            onOpenDetail={detail.openDetail}
          />
          <ItemList
            projectId={project.id}
            items={active}
            prefix={project.prefix}
            prLinksByItem={prLinksByItem}
            onOpenDetail={detail.openDetail}
          />
        </div>
      </div>

      {detail.item && (
        <ItemDetailSheet
          item={detail.item}
          prLinks={prLinksByItem[detail.item.id] ?? []}
          open={detail.open}
          onOpenChange={detail.onOpenChange}
        />
      )}
    </article>
  );
}
