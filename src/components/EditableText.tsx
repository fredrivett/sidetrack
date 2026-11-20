"use client";

import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";

import type { AssigneeView } from "@/core/members";
import { cn } from "@/lib/utils";
import { MentionTextarea } from "./MentionTextarea";
import { useDraft } from "./use-draft";
import { useHydrated } from "./use-stored-state";

/** Multi-line text is writing, so it must say where an unsaved edit is kept. */
type DraftProps =
  | { multiline: true; draftKey: string | null }
  | { multiline?: false; draftKey?: string | null };

export function EditableText({
  value,
  onSave,
  multiline = false,
  draftKey = null,
  placeholder,
  required = false,
  maxLength,
  hold = false,
  className = "",
  inputClassName = "",
  renderValue,
  onDraftChange,
  mentions,
  readOnly = false,
}: DraftProps & {
  value: string;
  /** Saves the new text. Wrap the action in runAction, so a failure toasts
   * rather than throwing. Return its promise: the field shows the new text,
   * or with `hold` dims, until it settles. */
  onSave: (next: string) => Promise<unknown>;
  placeholder?: string;
  // When true, an empty value is rejected: blanking the field reverts to the
  // current value instead of saving (mirrors the core's non-empty guard).
  required?: boolean;
  maxLength?: number;
  /** Hold rather than show the new text, for values the server cleans up or
   * can reject: the field keeps the saved text, dimmed, until the save lands. */
  hold?: boolean;
  className?: string;
  inputClassName?: string;
  // Custom rendering for the non-editing display of a non-empty value (e.g. a
  // badge). The empty state still falls back to the muted placeholder text.
  renderValue?: (value: string) => React.ReactNode;
  /** The text as it's typed, then null once the edit is over (after the
   * save lands, for a change), e.g. so an emoji follows a title being typed. */
  onDraftChange?: (draft: string | null) => void;
  /** Multiline only: typing `@` suggests these people to mention, as the
   * new-comment box does. */
  mentions?: AssigneeView[];
  /** Shows the value, not editable, for someone who can't change it; nothing when empty. */
  readOnly?: boolean;
}) {
  // "resumed" when it's an edit left unsaved by a reload, picked up again.
  const [editing, setEditing] = useState<false | "fresh" | "resumed">(false);
  // The saved text shown ahead of the server, so the field doesn't snap back
  // to the old text while it saves; if the save fails, the old text returns.
  const [shown, showSaving] = useOptimistic(value);
  // Kept under `draftKey` (useDraft) from the first key typed until the
  // edit is saved or dropped, so a reload doesn't lose it.
  const draft = useDraft(draftKey, shown);
  const hydrated = useHydrated();
  const [resumed, setResumed] = useState(false);
  if (hydrated && !resumed) {
    setResumed(true);
    // Not for someone who can no longer change it (their role changed).
    if (draft.value !== shown && !readOnly) setEditing("resumed");
  }
  const [saving, startSaving] = useTransition();
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  // Counts edits, so a save that lands after the next edit has started
  // doesn't end that edit's draft.
  const edits = useRef(0);

  // Draft only matters while editing; the non-editing branch renders `shown`
  // directly. Seed draft at the moment editing starts, not via an effect.
  function startEditing() {
    edits.current += 1;
    draft.clear();
    setEditing("fresh");
  }

  useEffect(() => {
    const el = ref.current;
    if (!editing || !el) return;
    el.focus();
    // A resumed edit carries on where it was, rather than being typed over.
    if (editing === "fresh") el.select?.();
    else el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  function commit() {
    setEditing(false);
    const trimmed = draft.value.trim();
    // A required field can't be blanked — discard the edit and revert.
    if (required && !trimmed) {
      draft.clear();
      onDraftChange?.(null);
      return;
    }
    if (trimmed !== shown.trim()) {
      const edit = edits.current;
      startSaving(async () => {
        if (!hold) showSaving(trimmed);
        const saved = await onSave(trimmed);
        if (edits.current !== edit) return;
        onDraftChange?.(null);
        // A failed save (runAction's false) keeps the draft, so a reload,
        // such as the one a save from an outdated page brings, puts it back.
        if (saved !== false) draft.clear();
      });
    } else {
      draft.clear();
      onDraftChange?.(null);
    }
  }

  function cancel() {
    setEditing(false);
    draft.clear();
    onDraftChange?.(null);
  }

  function type(next: string) {
    draft.set(next);
    onDraftChange?.(next);
  }

  if (readOnly) {
    if (!shown) return null;
    return (
      <span className={`text-left ${className}`}>{renderValue ? renderValue(shown) : shown}</span>
    );
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => !(hold && saving) && startEditing()}
        aria-disabled={(hold && saving) || undefined}
        aria-busy={(hold && saving) || undefined}
        className={`text-left ${shown ? "" : "text-neutral-400"} ${hold && saving ? "opacity-60" : ""} ${className}`}
      >
        {shown ? (renderValue ? renderValue(shown) : shown) : placeholder || ""}
      </button>
    );
  }

  if (multiline) {
    return (
      <MentionTextarea
        ref={ref as React.RefObject<HTMLTextAreaElement>}
        people={mentions ?? []}
        draft={{ ...draft, set: type }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Escape") cancel();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit();
        }}
        rows={3}
        placeholder={placeholder}
        maxLength={maxLength}
        className={cn(
          "w-full resize-none rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400 dark:border-neutral-700",
          inputClassName,
        )}
      />
    );
  }

  return (
    <input
      ref={ref as React.RefObject<HTMLInputElement>}
      type="text"
      value={draft.value}
      onChange={(e) => type(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Escape") cancel();
        if (e.key === "Enter") commit();
      }}
      placeholder={placeholder}
      maxLength={maxLength}
      className={cn(
        "rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400 dark:border-neutral-700",
        inputClassName,
      )}
    />
  );
}
