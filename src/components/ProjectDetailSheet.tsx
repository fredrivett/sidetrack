"use client";

import { ExternalLink, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteProjectAction, updateProjectAction } from "@/app/actions";
import type { Project } from "@/core/schema";
import { validatePrefix } from "@/lib/itemRef";
import { dayLabel } from "@/lib/time";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useMediaQuery } from "@/components/ui/use-media-query";
import { EditableText } from "./EditableText";
import { ProjectIconPicker } from "./ProjectIconPicker";
import { StatusBadge } from "./StatusBadge";

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

export function ProjectDetailSheet({
  project,
  open,
  onOpenChange,
}: {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Sidebar slide-out on desktop, bottom drawer on mobile — matches
  // ItemDetailSheet's responsive default.
  const isDesktop = useMediaQuery("(min-width: 768px)", true);
  const [pending, start] = useTransition();
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
    start(() => {
      void updateProjectAction(project.id, { prefix: normalized }).catch(() =>
        toast.error("Couldn't update the prefix. Please try again."),
      );
    });
  }

  // The core normalizes (adds a scheme, validates the host) and throws on a
  // value that isn't a real URL — catch it and nudge rather than failing silently.
  function saveHomepage(next: string) {
    start(() => {
      void updateProjectAction(project.id, {
        homepageUrl: next.trim() ? next : null,
      }).catch(() => toast.error("That doesn't look like a valid URL."));
    });
  }

  function del() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    start(() => {
      void deleteProjectAction(project.id);
    });
    change(false);
  }

  return (
    <Sheet open={open} onOpenChange={change}>
      <SheetContent
        side={isDesktop ? "right" : "bottom"}
        className={
          isDesktop
            ? "w-full gap-0 p-0 data-[side=right]:sm:max-w-md"
            : "max-h-[85vh] gap-0 rounded-t-xl p-0"
        }
      >
        <SheetHeader className="gap-2 border-b border-neutral-200 px-4 py-3 pr-14 dark:border-neutral-800">
          <div className="flex items-center gap-2">
            <ProjectIconPicker project={project} size={22} />
            <StatusBadge projectId={project.id} status={project.status} />
          </div>
          <SheetTitle className="text-base">
            <EditableText
              value={project.name}
              onSave={(next) =>
                updateProjectAction(project.id, { name: next })
              }
              required
              className="block w-full break-words text-base font-semibold"
              inputClassName="w-full text-base font-semibold"
            />
          </SheetTitle>
          <SheetDescription className="sr-only">
            Project details for {project.name}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <Field label="Summary">
            <EditableText
              value={project.summary}
              onSave={(next) =>
                updateProjectAction(project.id, { summary: next })
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

        <SheetFooter className="mt-0 flex-row items-center justify-between border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <span className="text-xs text-neutral-400">
            Created {dayLabel(project.createdAt)}
          </span>
          <Button
            variant="destructive"
            size="sm"
            onClick={del}
            disabled={pending}
          >
            <Trash2 />
            {confirmingDelete ? "Confirm delete?" : "Delete"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
