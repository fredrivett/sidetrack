"use client";

import { useEffect, useRef, useState } from "react";

export function EditableText({
  value,
  onSave,
  multiline = false,
  placeholder,
  className = "",
  inputClassName = "",
}: {
  value: string;
  onSave: (next: string) => void | Promise<unknown>;
  multiline?: boolean;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
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
        {value || placeholder || ""}
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
