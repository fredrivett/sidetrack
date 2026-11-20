"use client";

import { GitBranch, Globe, Hash, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
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
  ResponsiveDialogViews,
} from "@/components/ui/responsive-dialog";
import { CHIP, EMPTY_CHIP, Field, TextChip } from "./DialogFields";
import { EditableText } from "./EditableText";
import type { ProjectView } from "./Kanban";
import { LabelBadge, useListLabels } from "./Labels";
import { LabelView, ListLabelsField, useLabelUsage } from "./ListLabels";
import { ProjectIconPicker, useListIcon } from "./ProjectIconPicker";
import { StatusBadge } from "./StatusBadge";
import { runAction } from "./run-action";
import { useListSave, useRemoveList } from "./use-list-saves";

/** What's wrong with a value typed in a chip, as the server would refuse it. */
function problem(check: () => unknown, message: string): string | null {
  try {
    check();
    return null;
  } catch {
    return message;
  }
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
  // The label shown on its own, if any, and the one to focus coming back.
  const [labelId, setLabelId] = useState<string | null>(null);
  const [backFrom, setBackFrom] = useState<string | null>(null);
  // Each opening starts on the list's details. Reset as it opens, not as it
  // closes, so the view doesn't change under the closing animation.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setLabelId(null);
      setBackFrom(null);
    }
  }
  const labels = useListLabels(project.id);
  // A viewer or commenter reads the details; they change nothing.
  const canEdit = project.access === "edit";
  // Gone once it's deleted, which goes back to the list's details, with
  // nothing there to focus.
  const label = labels.find((l) => l.id === labelId);
  if (labelId !== null && !label) {
    setLabelId(null);
    setBackFrom(null);
  }
  const { usage, reload } = useLabelUsage(
    project.id,
    open,
    JSON.stringify([labelId, labels.map((l) => [l.id, l.name, l.archivedAt])]),
  );
  function back() {
    setBackFrom(labelId);
    setLabelId(null);
  }

  function change(next: boolean) {
    if (!next) setConfirmingDelete(false);
    onOpenChange(next);
  }

  // Each is checked in its chip first, so a typo is turned away there;
  // they hold because the server decides what's stored.
  function savePrefix(next: string) {
    void save(() =>
      runAction(updateProjectAction(project.id, { prefix: next.toUpperCase() }), "update the prefix"),
    );
  }
  function saveHomepage(next: string) {
    void save(() =>
      runAction(updateProjectAction(project.id, { homepageUrl: next || null }), "save the homepage"),
    );
  }
  function saveRepository(next: string) {
    void save(() =>
      runAction(updateProjectAction(project.id, { repository: next || null }), "save the repository"),
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
        <ResponsiveDialogViews
          view={label ? `label:${label.id}` : "list"}
          direction={label ? "forward" : "back"}
        >
          {label ? (
            <LabelView
              label={label}
              listName={project.name}
              prefix={project.refPrefix}
              usage={usage?.[label.id]}
              onBack={back}
              onRefused={reload}
            />
          ) : (
            <>
              <div className="flex shrink-0 flex-col gap-2 border-b border-neutral-200 px-4 pt-3 pb-4 dark:border-neutral-800">
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
                    readOnly={!canEdit}
                    className="block w-full break-words text-base leading-6 font-medium"
                    inputClassName="w-full text-base"
                  />
                </ResponsiveDialogTitle>
                <ResponsiveDialogDescription className="sr-only">
                  List details for {project.name}
                </ResponsiveDialogDescription>
                <EditableText
                  value={project.summary}
                  draftKey={`list:${project.id}:summary`}
                  onSave={(next) =>
                    runAction(updateProjectAction(project.id, { summary: next }), "save the summary")
                  }
                  multiline
                  placeholder="Add summary…"
                  readOnly={!canEdit}
                  className="block w-full whitespace-pre-wrap break-words text-sm text-neutral-600 dark:text-neutral-300"
                  inputClassName="w-full text-sm"
                />
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  {canEdit ? (
                    <>
                      <TextChip
                        icon={<Hash />}
                        label="ID prefix"
                        value={project.prefix}
                        placeholder="e.g. HOM"
                        validate={(next) => validatePrefix(next.toUpperCase())}
                        onSave={savePrefix}
                        disabled={saving}
                        inputClassName="font-mono uppercase"
                      >
                        <span className="font-mono text-xs tracking-wide">{project.prefix}</span>
                      </TextChip>
                      <TextChip
                        icon={<Globe />}
                        label="Homepage"
                        value={project.homepageUrl ?? ""}
                        placeholder="example.com"
                        validate={(next) =>
                          problem(() => normalizeHomepageUrl(next), "That doesn't look like a valid URL.")
                        }
                        onSave={saveHomepage}
                        href={project.homepageUrl}
                        hrefLabel="Open homepage"
                        disabled={saving}
                      >
                        <span className="max-w-48 truncate">
                          {project.homepageUrl?.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
                        </span>
                      </TextChip>
                    </>
                  ) : (
                    // Read-only: what's set, as plain chips.
                    <>
                      <span className={CHIP}>
                        <Hash />
                        <span className="font-mono text-xs tracking-wide">{project.prefix}</span>
                      </span>
                      {project.homepageUrl && (
                        <a
                          href={project.homepageUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          title="Open homepage"
                          className={CHIP}
                        >
                          <Globe />
                          <span className="max-w-48 truncate">
                            {project.homepageUrl.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
                          </span>
                        </a>
                      )}
                    </>
                  )}
                  {isAdmin ? (
                    <TextChip
                      icon={<GitBranch />}
                      label="Repository"
                      value={project.repository ?? ""}
                      placeholder="owner/repo"
                      validate={(next) =>
                        problem(
                          () => normalizeRepository(next),
                          "That doesn't look like a GitHub repository, such as owner/repo.",
                        )
                      }
                      onSave={saveRepository}
                      href={project.repository && `https://github.com/${project.repository}`}
                      hrefLabel="Open on GitHub"
                      disabled={saving}
                      inputClassName="font-mono"
                    >
                      <span className="max-w-56 truncate font-mono text-xs">{project.repository}</span>
                    </TextChip>
                  ) : (
                    // Only the admin sets it; anyone can follow it.
                    project.repository && (
                      <a
                        href={`https://github.com/${project.repository}`}
                        target="_blank"
                        rel="noreferrer noopener"
                        title="Open on GitHub"
                        className={CHIP}
                      >
                        <GitBranch />
                        <span className="max-w-56 truncate font-mono text-xs">{project.repository}</span>
                      </a>
                    )
                  )}
                  {/* Only offered, never filled in: the repository decides what an
                      assigned agent checks out, so the admin confirms it. */}
                  {isAdmin && !project.repository && suggested && (
                    <button
                      type="button"
                      aria-disabled={saving || undefined}
                      onClick={() => {
                        if (!saving) saveRepository(suggested);
                      }}
                      title="Suggested from this list's linked pull requests"
                      className={EMPTY_CHIP}
                    >
                      <Sparkles />
                      <span className="max-w-56 truncate">
                        Use <span className="font-mono text-xs">{suggested}</span>?
                      </span>
                    </button>
                  )}
                </div>
              </div>

              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4">
                <Field label="Labels">
                  {canEdit ? (
                    <ListLabelsField
                      labels={labels}
                      usage={usage}
                      onOpen={setLabelId}
                      focusId={backFrom}
                    />
                  ) : labels.length ? (
                    <div className="flex flex-wrap gap-1">
                      {labels.map((l) => (
                        <LabelBadge key={l.id} name={l.name} emoji={l.emoji} />
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-neutral-400">No labels.</p>
                  )}
                </Field>
              </div>

              <div className="flex shrink-0 items-center justify-between border-t border-neutral-200 px-4 py-2.5 dark:border-neutral-800">
                <span className="text-xs text-neutral-400">
                  Created {dayLabel(project.createdAt)}
                </span>
                {canEdit && (
                <Button
                  variant={confirmingDelete ? "destructive" : "ghost"}
                  size="sm"
                  onClick={del}
                  disabled={saving}
                  className={confirmingDelete ? "" : "text-neutral-500 hover:text-destructive"}
                >
                  <Trash2 />
                  {confirmingDelete ? "Confirm delete?" : "Delete"}
                </Button>
                )}
              </div>
            </>
          )}
        </ResponsiveDialogViews>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
