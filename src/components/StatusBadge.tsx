"use client";

import { useTransition } from "react";
import { updateProjectAction } from "@/app/actions";
import { PROJECT_STATUSES, type ProjectStatus } from "@/core/schema";

const COLORS: Record<ProjectStatus, string> = {
  idea: "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  "pre-launch": "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  "early-access": "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  launched: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  paused: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200",
  dormant: "bg-neutral-100 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-500",
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
      <span>{status}</span>
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
            {s}
          </option>
        ))}
      </select>
    </label>
  );
}
