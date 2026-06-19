"use client";

import { useEffect } from "react";
import { isEditableTarget, matchesShortcut } from "@/lib/keyboard";

/** Linear's assignment shortcuts: A opens the assignee picker, I assigns to me. */
export const OPEN_ASSIGNEE_SHORTCUT = { key: "a" } as const;
export const ASSIGN_TO_ME_SHORTCUT = { key: "i" } as const;

/**
 * Arm Linear-style assignment shortcuts on the item that currently "owns" them:
 * `A` opens the assignee picker, `I` assigns to the viewer.
 *
 * `active` arms a document-level key listener — pass the condition under which
 * this item should own the shortcuts (a hovered card, an open detail sheet, …),
 * and disarm it while the picker itself is open so the menu keeps its own
 * keyboard handling. Set `deferToDialog` on a card so a still-hovered row behind
 * an open sheet yields to that sheet ([role=dialog]) rather than acting on the
 * wrong item. `onAssignToMe` is omitted when the viewer can't assign themselves
 * (not a candidate on this project), which also drops the `I` binding.
 */
export function useAssignShortcuts({
  active,
  deferToDialog,
  onOpenPicker,
  onAssignToMe,
}: {
  active: boolean;
  deferToDialog?: boolean;
  onOpenPicker: () => void;
  onAssignToMe?: () => void;
}) {
  useEffect(() => {
    if (!active) return;
    function onKeyDown(e: KeyboardEvent) {
      if (isEditableTarget(e.target)) return;
      // Bare keys only — never shadow ⌘A / Ctrl+A (select all) and friends.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // A hovered card behind an open sheet must not steal the shortcut from
      // the sheet, which renders a [role=dialog] popup over it.
      if (deferToDialog && document.querySelector('[role="dialog"]')) return;
      if (matchesShortcut(e, OPEN_ASSIGNEE_SHORTCUT)) {
        e.preventDefault();
        onOpenPicker();
      } else if (onAssignToMe && matchesShortcut(e, ASSIGN_TO_ME_SHORTCUT)) {
        e.preventDefault();
        onAssignToMe();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [active, deferToDialog, onOpenPicker, onAssignToMe]);
}
