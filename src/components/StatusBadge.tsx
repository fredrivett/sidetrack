"use client";

import { updateProjectAction } from "@/app/actions";
import { PROJECT_STATUSES, type ProjectStatus } from "@/core/schema";
import { runAction } from "./run-action";
import { useListSave } from "./use-list-saves";

const COLORS: Record<ProjectStatus, string> = {
  active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  archived: "bg-neutral-100 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-500",
};

const STATUS_LABEL: Record<ProjectStatus, string> = {
  active: "Active",
  archived: "Archived",
};

export function StatusBadge({
  projectId,
  status,
}: {
  projectId: string;
  status: ProjectStatus;
}) {
  // Held: the badge dims, with its column, until the change lands. The badge
  // dims too because in the list's details dialog the column is hidden.
  const { saving, save } = useListSave();
  return (
    <label
      aria-busy={saving || undefined}
      className={`relative inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${COLORS[status]} ${saving ? "opacity-60" : ""}`}
    >
      <span>{STATUS_LABEL[status]}</span>
      {/* Archiving goes through the list menu, which offers Undo, so only
          an archived list's badge can change it: back to active. */}
      {status === "archived" && (
        <select
          aria-label="Change status"
          value={status}
          onChange={(e) => {
            // aria-disabled rather than disabled while saving, so the select
            // keeps focus; a change made meanwhile is ignored.
            if (saving) return;
            const next = e.target.value as ProjectStatus;
            save(() =>
              runAction(updateProjectAction(projectId, { status: next }), "change the list's status"),
            );
          }}
          aria-disabled={saving || undefined}
          className="absolute inset-0 cursor-pointer opacity-0 aria-disabled:cursor-default"
        >
          {PROJECT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      )}
    </label>
  );
}
