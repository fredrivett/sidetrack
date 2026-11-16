"use client";

import { ExternalLink, GitBranch, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { updateProjectAction } from "@/app/actions";
import { validatePrefix } from "@/lib/itemRef";
import { normalizeRepository } from "@/lib/repository";
import { normalizeHomepageUrl } from "@/lib/url";
import { dayLabel } from "@/lib/time";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogCloseButton,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { EditableText } from "./EditableText";
import type { ProjectView } from "./Kanban";
import { ProjectIconPicker, useListIcon } from "./ProjectIconPicker";
import { StatusBadge } from "./StatusBadge";
import { runAction } from "./run-action";
import { useListSave, useRemoveList } from "./use-list-saves";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <span className="block text-[11px] font-medium uppercase tracking-wide text-neutral-400">
        {label}
      </span>
      {children}
    </div>
  );
}

export function ProjectDetailDialog({
  project,
  isAdmin,
  open,
  onOpenChange,
}: {
  project: ProjectView;
  /** The viewer is the list's admin (owner, or its Space's admin). */
  isAdmin: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Changes hold on the list's column until they land; deleting takes the
  // list off the board at once.
  const { saving, save } = useListSave();
  const removeList = useRemoveList();
  const listIcon = useListIcon(project);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const suggested = project.suggestedRepository;

  function change(next: boolean) {
    if (!next) setConfirmingDelete(false);
    onOpenChange(next);
  }

  // Validate/normalize client-side before the round trip so a bad prefix never
  // hits the core (which would throw); surface the same guidance as the menu.
  async function savePrefix(next: string) {
    const normalized = next.trim().toUpperCase();
    if (normalized === project.prefix) return;
    const err = validatePrefix(normalized);
    if (err) {
      toast.error(err);
      return;
    }
    await save(() => runAction(updateProjectAction(project.id, { prefix: normalized }), "update the prefix"));
  }

  // Check the URL here, as New list does, so a typo gets its own message and
  // any other failure gets runAction's; the core normalizes it again.
  async function saveHomepage(next: string) {
    try {
      normalizeHomepageUrl(next);
    } catch {
      toast.error("That doesn't look like a valid URL.");
      return;
    }
    await save(() =>
      runAction(
        updateProjectAction(project.id, { homepageUrl: next.trim() ? next : null }),
        "save the homepage",
      ),
    );
  }

  // Same as the homepage: a typo gets its own message, and the save holds
  // because the server decides the stored "owner/repo".
  async function saveRepository(next: string) {
    try {
      normalizeRepository(next);
    } catch {
      toast.error("That doesn't look like a GitHub repository, such as owner/repo.");
      return;
    }
    await save(() =>
      runAction(
        updateProjectAction(project.id, { repository: next.trim() ? next : null }),
        "save the repository",
      ),
    );
  }

  function del() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    removeList({ id: project.id, name: project.name, kind: "delete" });
    change(false);
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={change}>
      <ResponsiveDialogContent>
        <div className="flex shrink-0 flex-col gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <div className="flex items-center gap-2">
            <ProjectIconPicker project={project} listIcon={listIcon} size={22} />
            <StatusBadge status={project.status} />
            <ResponsiveDialogCloseButton className="ml-auto" />
          </div>
          <ResponsiveDialogTitle>
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
              className="block w-full break-words text-base font-semibold"
              inputClassName="w-full text-base font-semibold"
            />
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="sr-only">
            List details for {project.name}
          </ResponsiveDialogDescription>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4">
          <Field label="Summary">
            <EditableText
              value={project.summary}
              onSave={(next) =>
                runAction(updateProjectAction(project.id, { summary: next }), "save the summary")
              }
              multiline
              placeholder="Add a summary…"
              className="block w-full whitespace-pre-wrap break-words text-sm text-neutral-600 dark:text-neutral-300"
              inputClassName="w-full text-sm"
            />
          </Field>

          <Field label="ID prefix">
            <EditableText
              value={project.prefix}
              onSave={savePrefix}
              required
              hold
              className="block w-full break-words text-sm"
              inputClassName="w-full text-sm font-mono uppercase"
              renderValue={(prefix) => (
                <span className="inline-block rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs tracking-wide text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                  {prefix}
                </span>
              )}
            />
          </Field>

          <Field label="Homepage">
            <div className="flex items-center gap-2">
              <EditableText
                value={project.homepageUrl ?? ""}
                onSave={saveHomepage}
                hold
                placeholder="Add homepage URL…"
                className="block min-w-0 flex-1 truncate text-sm text-neutral-600 dark:text-neutral-300"
                inputClassName="w-full text-sm"
              />
              {project.homepageUrl && (
                <a
                  href={project.homepageUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  title="Open homepage"
                  className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-950/40"
                >
                  <ExternalLink className="size-3.5" />
                  Open
                </a>
              )}
            </div>
          </Field>

          {(isAdmin || project.repository) && (
            <Field label="Repository">
              <div className="flex items-center gap-2">
                {isAdmin ? (
                  <EditableText
                    value={project.repository ?? ""}
                    onSave={saveRepository}
                    hold
                    placeholder="Add GitHub repository…"
                    className="block min-w-0 flex-1 truncate font-mono text-sm text-neutral-600 dark:text-neutral-300"
                    inputClassName="w-full text-sm font-mono"
                  />
                ) : (
                  <span className="block min-w-0 flex-1 truncate font-mono text-sm text-neutral-600 dark:text-neutral-300">
                    {project.repository}
                  </span>
                )}
                {project.repository && (
                  <a
                    href={`https://github.com/${project.repository}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    title="Open on GitHub"
                    className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-950/40"
                  >
                    <GitBranch className="size-3.5" />
                    Open
                  </a>
                )}
              </div>
              {/* Only offered, never filled in: the repository decides what an
                  assigned agent checks out, so the admin confirms it. */}
              {isAdmin && !project.repository && suggested && (
                <button
                  type="button"
                  aria-disabled={saving}
                  onClick={() => {
                    if (!saving) void saveRepository(suggested);
                  }}
                  title="Suggested from this list's linked pull requests"
                  className="inline-flex max-w-full items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 dark:text-blue-300 dark:hover:bg-blue-950/40"
                >
                  <Sparkles className="size-3.5 shrink-0" />
                  <span className="truncate">
                    Use <span className="font-mono">{suggested}</span>
                  </span>
                </button>
              )}
            </Field>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <span className="text-xs text-neutral-400">
            Created {dayLabel(project.createdAt)}
          </span>
          <Button
            variant="destructive"
            size="sm"
            onClick={del}
            disabled={saving}
          >
            <Trash2 />
            {confirmingDelete ? "Confirm delete?" : "Delete"}
          </Button>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
