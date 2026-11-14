"use client";

import { useTransition } from "react";
import { updateProjectAction } from "@/app/actions";
import { PROJECT_STATUSES, type ProjectStatus } from "@/core/schema";

const COLORS: Record<ProjectStatus, string> = {
  active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  paused: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200",
  archived: "bg-neutral-100 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-500",
};

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  active: "Active",
  paused: "Paused",
  archived: "Archived",
};

export function StatusBadge({
  projectId,
  status,
}: {
  projectId: string;
  status: ProjectStatus;
}) {
  const [pending, start] = useTransition();
  return (
    <label
      className={`relative inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${COLORS[status]} ${pending ? "opacity-60" : ""}`}
    >
      <span>{STATUS_LABEL[status]}</span>
      <select
        aria-label="Change status"
        value={status}
        onChange={(e) => {
          const next = e.target.value as ProjectStatus;
          start(() => {
            void updateProjectAction(projectId, { status: next });
          });
        }}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {PROJECT_STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
      </select>
    </label>
  );
}
