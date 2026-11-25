"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";
import type { LabelEmoji } from "@/core/labels";
import type { AssigneeView } from "@/core/members";
import type { Repeat } from "@/lib/repeat";
import type { Due } from "@/lib/time";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  ResponsiveDialogCloseButton,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { AssigneeOptions } from "./AssigneeOptions";
import { AssigneeChip, DueChip, EMPTY_CHIP, RepeatChip } from "./DialogFields";
import { LabelChips } from "./Labels";
import { MentionTextarea } from "./MentionTextarea";
import { useDraft } from "./use-draft";

/**
 * A checklist line typed in New item before the item exists, with the
 * fields a sub-item has. Its description is a draft of its own
 * (`lineDescriptionKey`), read as the item's added.
 */
export type NewLine = {
  id: string;
  title: string;
  done: boolean;
  due?: Due | null;
  repeat?: Repeat | null;
  assigneeIds?: string[];
  labels?: string[];
};

export const LINE_DRAFTS = "new-item:line:";
export const lineDescriptionKey = (id: string) => `${LINE_DRAFTS}${id}:description`;

const NO_PEOPLE: AssigneeView[] = [];

/**
 * One line of New item's checklist opened, as a sub-item's own dialog is
 * once it's saved: its title, description, due date, repeat, assignees and
 * labels, kept with the draft until the item's added. Its list and parent
 * are the item's, so it offers neither.
 */
export function NewItemLine({
  line,
  onChange,
  onRemove,
  back,
  projectId,
  assignees,
  viewerId,
  labelEmoji,
  onLabelEmoji,
  disabled,
}: {
  line: NewLine;
  onChange: (patch: Partial<NewLine>) => void;
  onRemove: () => void;
  /** The way back to the form. */
  back: React.ReactNode;
  /** The item's list, \"\" until one's chosen. */
  projectId: string;
  /** Who's on that list; only those who can edit it can be assigned. */
  assignees: AssigneeView[];
  viewerId: string;
  /** The emoji for labels new to the list, shared with the item's. */
  labelEmoji: Record<string, LabelEmoji>;
  onLabelEmoji: (name: string, emoji: LabelEmoji) => void;
  disabled: boolean;
}) {
  const description = useDraft(lineDescriptionKey(line.id));
  // What's in the title field: it can be emptied while retyping, but the
  // line keeps its last title, so clearing it never drops the line and its
  // fields. Leaving the field empty puts that title back.
  const [titleText, setTitleText] = useState(line.title);
  const [dueOpen, setDueOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const editors = assignees.filter((a) => a.canEdit);
  // Someone picked on another list stays on the line, for switching back,
  // but only the list's editors are shown and added.
  const assigned = editors.filter((a) => line.assigneeIds?.includes(a.userId));
  const labels = line.labels ?? [];
  const noList = !projectId;

  return (
    <>
      <div className="flex shrink-0 flex-col gap-2 border-b border-neutral-200 px-4 pt-3 pb-4 dark:border-neutral-800">
        <div className="flex min-w-0 items-center gap-1">
          {back}
          <ResponsiveDialogCloseButton className="ml-auto" />
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            checked={line.done}
            onCheckedChange={(done) => onChange({ done })}
            disabled={disabled}
            aria-label={`${line.done ? "Uncomplete" : "Complete"} ${line.title}`}
            className="size-5"
          />
          <ResponsiveDialogTitle className="min-w-0 flex-1">
            {/* The line's title is kept with the checklist, a draft already. */}
            <Input
              value={titleText}
              onChange={(e) => {
                setTitleText(e.target.value);
                if (e.target.value.trim()) onChange({ title: e.target.value });
              }}
              onBlur={() => {
                if (!titleText.trim()) setTitleText(line.title);
              }}
              aria-label="Sub-item title"
              disabled={disabled}
              className="h-auto border-0 bg-transparent px-0 py-0 text-base leading-6 font-medium shadow-none focus-visible:ring-0 md:text-base dark:bg-transparent"
            />
          </ResponsiveDialogTitle>
        </div>
        <ResponsiveDialogDescription className="sr-only">
          A sub-item of the new item, added with it.
        </ResponsiveDialogDescription>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4">
        {/* Unstyled, like New item's own; no one to mention yet. */}
        <MentionTextarea
          people={NO_PEOPLE}
          draft={description}
          placeholder="Add description…"
          aria-label="Description"
          disabled={disabled}
          rows={1}
          className="field-sizing-content max-h-48 w-full resize-none bg-transparent text-sm text-neutral-600 outline-none placeholder:text-muted-foreground disabled:opacity-50 dark:text-neutral-300"
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <DueChip
            due={line.due ?? null}
            done={line.done}
            disabled={disabled}
            onChange={(due) => onChange({ due })}
            open={dueOpen}
            setOpen={setDueOpen}
          />
          <RepeatChip
            repeat={line.repeat ?? null}
            completedAt={null}
            disabled={disabled}
            onChange={(repeat) => onChange({ repeat })}
          />
          {/* Who can be assigned, and which labels there are, depend on the list. */}
          <AssigneeChip
            assigned={assigned}
            disabled={disabled || noList}
            open={assignOpen}
            setOpen={(next) => setAssignOpen(next && !noList)}
          >
            <AssigneeOptions
              selected={assigned.map((a) => a.userId)}
              assignees={assignees}
              viewerId={viewerId}
              onChange={(ids) =>
                onChange({
                  assigneeIds: [
                    ...(line.assigneeIds ?? []).filter((id) => !assignees.some((a) => a.userId === id)),
                    ...ids,
                  ],
                })
              }
              onClear={() => onChange({ assigneeIds: [] })}
            />
          </AssigneeChip>
          {!noList && (
            <LabelChips
              projectId={projectId}
              value={labels}
              onChange={(names, added) => {
                onChange({ labels: names });
                if (added?.emoji) onLabelEmoji(added.name, added.emoji);
              }}
              draftEmoji={labelEmoji}
              onRenamed={(from, to) => onChange({ labels: labels.map((n) => (n === from ? to : n)) })}
              onDraftEmoji={(name, emoji) => onLabelEmoji(name, { emoji, chosen: true })}
              disabled={disabled}
              chipClassName={labels.length ? `${EMPTY_CHIP} px-2` : EMPTY_CHIP}
            />
          )}
        </div>
        {noList && (
          <p className="text-xs text-muted-foreground">
            Choose the item’s list to assign this or label it.
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <Button type="button" variant="ghost" size="sm" onClick={onRemove} disabled={disabled}>
          <Trash2 data-icon="inline-start" />
          Remove
        </Button>
      </div>
    </>
  );
}
