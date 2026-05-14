"use client";

import { updateProjectAction } from "@/app/actions";
import { EditableText } from "./EditableText";

export function SummaryBlock({
  projectId,
  summary,
  summaryUpdatedAt,
}: {
  projectId: string;
  summary: string;
  summaryUpdatedAt: number | null;
}) {
  return (
    <div className="space-y-1">
      <EditableText
        value={summary}
        onSave={(next) => updateProjectAction(projectId, { summary: next })}
        multiline
        placeholder="Tap to add a summary…"
        className="block w-full whitespace-pre-wrap text-sm text-neutral-600 dark:text-neutral-400"
        inputClassName="text-sm"
      />
      {summaryUpdatedAt && (
        <div className="text-[10px] uppercase tracking-wide text-neutral-400">
          updated {formatRelative(summaryUpdatedAt)}
        </div>
      )}
    </div>
  );
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const min = 60_000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (diff < min) return "just now";
  if (diff < hr) return `${Math.floor(diff / min)}m ago`;
  if (diff < day) return `${Math.floor(diff / hr)}h ago`;
  return `${Math.floor(diff / day)}d ago`;
}
