"use client";

import { useEffect, useRef, useState } from "react";

export function EditableText({
  value,
  onSave,
  multiline = false,
  placeholder,
  required = false,
  className = "",
  inputClassName = "",
  renderValue,
}: {
  value: string;
  onSave: (next: string) => void | Promise<unknown>;
  multiline?: boolean;
  placeholder?: string;
  // When true, an empty value is rejected: blanking the field reverts to the
  // current value instead of saving (mirrors the core's non-empty guard).
  required?: boolean;
  className?: string;
  inputClassName?: string;
  // Custom rendering for the non-editing display of a non-empty value (e.g. a
  // badge). The empty state still falls back to the muted placeholder text.
  renderValue?: (value: string) => React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  // Draft only matters while editing; the non-editing branch renders `value`
  // directly. Seed draft at the moment editing starts, not via an effect.
  function startEditing() {
    setDraft(value);
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
      setDraft(value);
      return;
    }
    if (trimmed !== value.trim()) {
      void onSave(trimmed);
    } else {
      setDraft(value);
    }
  }

  function cancel() {
    setEditing(false);
    setDraft(value);
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={startEditing}
        className={`text-left ${value ? "" : "text-neutral-400"} ${className}`}
      >
        {value ? (renderValue ? renderValue(value) : value) : placeholder || ""}
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
        className={`w-full resize-none rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400 dark:border-neutral-700 ${inputClassName}`}
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
      className={`rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400 dark:border-neutral-700 ${inputClassName}`}
    />
  );
}
