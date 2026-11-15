"use client";

import { ExternalLink, Trash2 } from "lucide-react";
import { unstable_rethrow } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { updateProjectAction } from "@/app/actions";
import type { Project } from "@/core/schema";
import { validatePrefix } from "@/lib/itemRef";
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
import { ProjectIconPicker } from "./ProjectIconPicker";
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
  open,
  onOpenChange,
}: {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Changes hold on the list's column until they land; deleting takes the
  // list off the board at once.
  const { saving, save } = useListSave();
  const removeList = useRemoveList();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function change(next: boolean) {
    if (!next) setConfirmingDelete(false);
    onOpenChange(next);
  }

  // Validate/normalize client-side before the round trip so a bad prefix never
  // hits the core (which would throw); surface the same guidance as the menu.
  function savePrefix(next: string) {
    const normalized = next.trim().toUpperCase();
    if (normalized === project.prefix) return;
    const err = validatePrefix(normalized);
    if (err) {
      toast.error(err);
      return;
    }
    save(() => runAction(updateProjectAction(project.id, { prefix: normalized }), "update the prefix"));
  }

  // The core normalizes (adds a scheme, validates the host) and throws on a
  // value that isn't a real URL — catch it and nudge rather than failing silently.
  function saveHomepage(next: string) {
    save(() =>
      updateProjectAction(project.id, {
        homepageUrl: next.trim() ? next : null,
      }).catch((e) => {
        unstable_rethrow(e);
        toast.error("That doesn't look like a valid URL.");
      }),
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
            <ProjectIconPicker project={project} size={22} />
            <StatusBadge projectId={project.id} status={project.status} />
            <ResponsiveDialogCloseButton className="ml-auto" />
          </div>
          <ResponsiveDialogTitle>
            <EditableText
              value={project.name}
              onSave={(next) =>
                runAction(
                  updateProjectAction(project.id, { name: next }),
                  `rename “${project.name}”`,
                )
              }
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
