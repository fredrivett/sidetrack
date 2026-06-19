"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AssigneeView, PendingInviteView } from "@/core/members";
import type { Category, Item, ItemPrLink, Project } from "@/core/schema";
import { isEditableTarget, matchesShortcut } from "@/lib/keyboard";
import { AddProjectButton } from "./AddProjectButton";
import { AuditDrawer } from "./AuditDrawer";
import { InvitesBanner } from "./InvitesBanner";
import { NewItemSheet } from "./NewItemSheet";
import { NewProjectSheet } from "./NewProjectSheet";
import { ProjectColumn } from "./ProjectColumn";
import { ShareSheet } from "./ShareSheet";
import { UserMenu } from "./UserMenu";

/**
 * A project plus per-viewer display data: whether the viewer owns it (vs. it
 * being shared with them), and its display ref-prefix (qualified `alice/SID`
 * when the prefix clashes on this board, bare `SID` otherwise).
 */
export type ProjectView = Project & { isOwner: boolean; refPrefix: string };

/** The project currently centred in the rail, tracked in `?p=<id>`. */
function centredProjectId(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("p");
}

export function Kanban({
  viewerId,
  projects,
  itemsByProject,
  categoriesByProject,
  assigneesByProject,
  prLinksByItem,
  pendingInvites,
}: {
  viewerId: string;
  projects: ProjectView[];
  itemsByProject: Record<string, Item[]>;
  categoriesByProject: Record<string, Category[]>;
  assigneesByProject: Record<string, AssigneeView[]>;
  prLinksByItem: Record<string, ItemPrLink[]>;
  pendingInvites: PendingInviteView[];
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const initialised = useRef(false);
  const [audit, setAudit] = useState<{ open: boolean; projectId?: string }>({
    open: false,
  });
  const [newItem, setNewItem] = useState<{
    open: boolean;
    projectId: string | null;
  }>({ open: false, projectId: null });
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [share, setShare] = useState<{
    open: boolean;
    projectId: string | null;
    projectName: string;
  }>({ open: false, projectId: null, projectName: "" });

  const openShare = useCallback(
    (projectId: string, projectName: string) =>
      setShare({ open: true, projectId, projectName }),
    [],
  );

  // Open the new-item sheet, seeding its project from the caller, falling back
  // to the centred column then the first project. With no projects at all,
  // there's nowhere to add an item — start a project instead.
  const openNewItem = useCallback(
    (projectId?: string) => {
      if (projects.length === 0) {
        setNewProjectOpen(true);
        return;
      }
      const pid = projectId ?? centredProjectId() ?? projects[0].id;
      setNewItem({ open: true, projectId: pid });
    },
    [projects],
  );

  // Global shortcuts (Linear-style bare keys): C → new item, ⇧C → new project.
  // Skipped while typing in a field, and when a command modifier is held so we
  // don't shadow ⌘C / Ctrl+C copy.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isEditableTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (matchesShortcut(e, { key: "c", shift: true })) {
        e.preventDefault();
        setNewProjectOpen(true);
      } else if (matchesShortcut(e, { key: "c", shift: false })) {
        e.preventDefault();
        openNewItem();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [openNewItem]);

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
          <UserMenu />
        </div>
      </div>
      <InvitesBanner invites={pendingInvites} />
      <div
        ref={railRef}
        className="kanban-rail flex flex-1 snap-x snap-mandatory gap-3 overflow-x-auto overflow-y-hidden p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
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
            viewerId={viewerId}
            items={itemsByProject[p.id] ?? []}
            assignees={assigneesByProject[p.id] ?? []}
            prLinksByItem={prLinksByItem}
            prevId={projects[idx - 1]?.id ?? null}
            nextId={projects[idx + 1]?.id ?? null}
            onShowActivity={(pid) => setAudit({ open: true, projectId: pid })}
            onAddItem={openNewItem}
            onShare={openShare}
          />
        ))}
        <AddProjectButton onClick={() => setNewProjectOpen(true)} />
      </div>

      <AuditDrawer
        open={audit.open}
        projectId={audit.projectId}
        projects={projects}
        onClose={() => setAudit({ open: false })}
      />

      <NewItemSheet
        open={newItem.open}
        onOpenChange={(open) => setNewItem((s) => ({ ...s, open }))}
        projects={projects}
        categoriesByProject={categoriesByProject}
        initialProjectId={newItem.projectId}
      />

      <NewProjectSheet open={newProjectOpen} onOpenChange={setNewProjectOpen} />

      <ShareSheet
        open={share.open}
        onOpenChange={(open) => setShare((s) => ({ ...s, open }))}
        projectId={share.projectId}
        projectName={share.projectName}
      />
    </main>
  );
}
