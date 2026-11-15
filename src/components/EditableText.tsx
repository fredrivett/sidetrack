"use client";

import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";

import { cn } from "@/lib/utils";

export function EditableText({
  value,
  onSave,
  multiline = false,
  placeholder,
  required = false,
  maxLength,
  hold = false,
  className = "",
  inputClassName = "",
  renderValue,
}: {
  value: string;
  /** Saves the new text. Wrap the action in runAction, so a failure toasts
   * rather than throwing. Return its promise: the field shows the new text,
   * or with `hold` dims, until it settles. */
  onSave: (next: string) => Promise<unknown>;
  multiline?: boolean;
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
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  // The saved text shown ahead of the server, so the field doesn't snap back
  // to the old text while it saves; if the save fails, the old text returns.
  const [shown, showSaving] = useOptimistic(value);
  const [saving, startSaving] = useTransition();
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  // Draft only matters while editing; the non-editing branch renders `shown`
  // directly. Seed draft at the moment editing starts, not via an effect.
  function startEditing() {
    setDraft(shown);
    setEditing(true);
  }

  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus();
      ref.current.select?.();
    }
  }, [editing]);

  function commit() {
    setEditing(false);
    const trimmed = draft.trim();
    // A required field can't be blanked — discard the edit and revert.
    if (required && !trimmed) {
      setDraft(shown);
      return;
    }
    if (trimmed !== shown.trim()) {
      startSaving(async () => {
        if (!hold) showSaving(trimmed);
        await onSave(trimmed);
      });
    } else {
      setDraft(shown);
    }
  }

  function cancel() {
    setEditing(false);
    setDraft(shown);
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
      <textarea
        ref={ref as React.RefObject<HTMLTextAreaElement>}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
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
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
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
