"use client";

import { useEffect, useRef, useState } from "react";
import type { Category, Item, Project } from "@/core/schema";
import { AddProjectButton } from "./AddProjectButton";
import { AuditDrawer } from "./AuditDrawer";
import { ProjectColumn } from "./ProjectColumn";

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
  const [audit, setAudit] = useState<{ open: boolean; projectId?: string }>({
    open: false,
  });

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
        <div className="flex items-center gap-3">
          <span className="text-xs text-neutral-400">
            {projects.length} project{projects.length === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            onClick={() => setAudit({ open: true })}
            className="rounded-md border border-neutral-200 px-2 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-100 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Activity
          </button>
        </div>
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
            onShowActivity={(pid) => setAudit({ open: true, projectId: pid })}
          />
        ))}
        <AddProjectButton />
      </div>

      <AuditDrawer
        open={audit.open}
        projectId={audit.projectId}
        projects={projects}
        onClose={() => setAudit({ open: false })}
      />
    </main>
  );
}
