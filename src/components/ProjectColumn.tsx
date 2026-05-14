"use client";

import { updateProjectAction } from "@/app/actions";
import type { Category, Item, Project } from "@/core/schema";
import { AddItemForm } from "./AddItemForm";
import { CompletedSection } from "./CompletedSection";
import { EditableText } from "./EditableText";
import { ItemList } from "./ItemList";
import { ProjectMenu } from "./ProjectMenu";
import { StatusBadge } from "./StatusBadge";
import { SummaryBlock } from "./SummaryBlock";

export function ProjectColumn({
  project,
  items,
  categories,
  prevId,
  nextId,
}: {
  project: Project;
  items: Item[];
  categories: Category[];
  prevId: string | null;
  nextId: string | null;
}) {
  const completed = items.filter((i) => i.completedAt !== null);
  const active = items.filter((i) => i.completedAt === null);

  return (
    <article
      data-project-id={project.id}
      className="flex h-full snap-center shrink-0 flex-col gap-3 overflow-y-auto rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 w-[92vw] sm:w-80"
    >
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <EditableText
            value={project.name}
            onSave={(next) => updateProjectAction(project.id, { name: next })}
            className="block w-full truncate text-base font-semibold"
            inputClassName="w-full text-base font-semibold"
          />
          <StatusBadge projectId={project.id} status={project.status} />
        </div>
        <ProjectMenu
          projectId={project.id}
          prevId={prevId}
          nextId={nextId}
          name={project.name}
        />
      </header>

      <SummaryBlock
        projectId={project.id}
        summary={project.summary}
        summaryUpdatedAt={project.summaryUpdatedAt}
      />

      <div className="flex-1 space-y-3 pt-1">
        <CompletedSection items={completed} />
        <ItemList items={active} />
      </div>

      <AddItemForm projectId={project.id} categories={categories} />
    </article>
  );
}
