"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useCopy } from "@/components/ui/use-copy";
import { isEditableTarget, matchesShortcut } from "@/lib/keyboard";

/** Linear's "copy issue ID" shortcut: ⌘. on Apple, Ctrl+. elsewhere. */
const COPY_REF_SHORTCUT = { key: ".", mod: true } as const;

/**
 * Copy an item ref (e.g. "ENG-42") to the clipboard, with transient `copied`
 * feedback and an optional ⌘./Ctrl+. keyboard shortcut.
 *
 * `shortcut.active` arms a document-level key listener — pass the condition
 * under which this item should own the shortcut (a hovered card, an open detail
 * dialog, …). Set `shortcut.deferToDialog` on a card so a still-hovered row
 * behind an open dialog yields the shortcut to that dialog ([role=dialog]) rather
 * than copying the wrong ref. Set `shortcut.toast` when no on-screen control
 * shows `copied` while the shortcut fires (a hovered card), so the copy is
 * confirmed with a toast instead.
 */
export function useCopyItemRef(
  ref: string,
  shortcut: { active: boolean; deferToDialog?: boolean; toast?: boolean },
) {
  const { copied, copy } = useCopy(ref);

  const { active, deferToDialog, toast: toastOnShortcut } = shortcut;
  useEffect(() => {
    if (!active) return;
    async function onKeyDown(e: KeyboardEvent) {
      if (isEditableTarget(e.target)) return;
      if (!matchesShortcut(e, COPY_REF_SHORTCUT)) return;
      // A hovered card behind an open dialog must not steal the shortcut from
      // the dialog, which renders a [role=dialog] popup over it.
      if (deferToDialog && document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      if ((await copy()) && toastOnShortcut) toast.success(`Copied ${ref}`);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [active, deferToDialog, toastOnShortcut, copy, ref]);

  return { copied, copy };
}
