"use client";

import type { ProjectStatus } from "@/core/schema";
import { useListSave } from "./use-list-saves";

const COLORS: Record<ProjectStatus, string> = {
  active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  archived: "bg-neutral-100 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-500",
};

const STATUS_LABEL: Record<ProjectStatus, string> = {
  active: "Active",
  archived: "Archived",
};

/**
 * A list's status. Archiving and restoring go through the list's ⋯ menu,
 * so this only shows it.
 */
export function StatusBadge({ status }: { status: ProjectStatus }) {
  // The badge dims, with its column, while a change to the list saves; it
  // dims too because in the list's details dialog the column is hidden.
  const { saving } = useListSave();
  return (
    <span
      aria-busy={saving || undefined}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${COLORS[status]} ${saving ? "opacity-60" : ""}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
