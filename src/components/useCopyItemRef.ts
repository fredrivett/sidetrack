"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { isEditableTarget, matchesShortcut } from "@/lib/keyboard";

/** Linear's "copy issue ID" shortcut: ⌘. on Apple, Ctrl+. elsewhere. */
const COPY_REF_SHORTCUT = { key: ".", mod: true } as const;

/**
 * Copy an item ref (e.g. "ENG-42") to the clipboard, with transient `copied`
 * feedback and an optional ⌘./Ctrl+. keyboard shortcut.
 *
 * `shortcut.active` arms a document-level key listener — pass the condition
 * under which this item should own the shortcut (a hovered card, an open detail
 * sheet, …). Set `shortcut.deferToDialog` on a card so a still-hovered row
 * behind an open sheet yields the shortcut to that sheet ([role=dialog]) rather
 * than copying the wrong ref.
 */
export function useCopyItemRef(
  ref: string,
  shortcut: { active: boolean; deferToDialog?: boolean },
) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(async () => {
    if (!navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(ref);
      toast.success(`Copied ${ref}`);
      setCopied(true);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }, [ref]);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  const { active, deferToDialog } = shortcut;
  useEffect(() => {
    if (!active) return;
    function onKeyDown(e: KeyboardEvent) {
      if (isEditableTarget(e.target)) return;
      if (!matchesShortcut(e, COPY_REF_SHORTCUT)) return;
      // A hovered card behind an open sheet must not steal the shortcut from
      // the sheet, which renders a [role=dialog] popup over it.
      if (deferToDialog && document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      void copy();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [active, deferToDialog, copy]);

  return { copied, copy };
}
