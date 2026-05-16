"use client";

import { updateProjectAction } from "@/app/actions";
import { formatRelative } from "@/lib/time";
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
