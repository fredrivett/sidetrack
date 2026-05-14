"use client";

import { useEffect, useRef } from "react";
import { AddProjectButton } from "./AddProjectButton";
import { ProjectColumn } from "./ProjectColumn";
import type { Category, Item, Project } from "@/core/schema";

export function Kanban({
  projects,
  itemsByProject,
  categoriesByProject,
}: {
  projects: Project[];
  itemsByProject: Record<string, Item[]>;
  categoriesByProject: Record<string, Category[]>;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const initialised = useRef(false);

  // On first paint: scroll to ?p=<id> if present.
  useEffect(() => {
    if (initialised.current) return;
    initialised.current = true;
    const params = new URLSearchParams(window.location.search);
    const targetId = params.get("p");
    if (!targetId) return;
    const el = railRef.current?.querySelector(
      `[data-project-id="${CSS.escape(targetId)}"]`,
    );
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ behavior: "instant", inline: "center" });
    }
  }, []);

  // Observe which column is most centred; reflect in ?p=<id> via replaceState.
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;

    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        const id = (visible.target as HTMLElement).dataset.projectId;
        if (!id) return;
        const url = new URL(window.location.href);
        if (url.searchParams.get("p") === id) return;
        url.searchParams.set("p", id);
        window.history.replaceState(null, "", url.toString());
      },
      {
        root: rail,
        threshold: [0.55, 0.75, 0.95],
      },
    );

    rail.querySelectorAll("[data-project-id]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [projects]);

  return (
    <main className="flex h-dvh flex-col">
      <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
        <h1 className="text-sm font-semibold tracking-tight">Sidetrack</h1>
        <span className="text-xs text-neutral-400">
          {projects.length} project{projects.length === 1 ? "" : "s"}
        </span>
      </div>
      <div
        ref={railRef}
        className="kanban-rail flex flex-1 snap-x snap-mandatory gap-3 overflow-x-auto overflow-y-hidden p-3"
      >
        {projects.length === 0 && (
          <div className="m-auto text-sm text-neutral-500">
            No projects yet — tap + Add project to start.
          </div>
        )}
        {projects.map((p, idx) => (
          <ProjectColumn
            key={p.id}
            project={p}
            items={itemsByProject[p.id] ?? []}
            categories={categoriesByProject[p.id] ?? []}
            prevId={projects[idx - 1]?.id ?? null}
            nextId={projects[idx + 1]?.id ?? null}
          />
        ))}
        <AddProjectButton />
      </div>
    </main>
  );
}
