"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { isEditableTarget, matchesShortcut } from "@/lib/keyboard";

/**
 * ⌘./Ctrl+. copies the ref of the item under the pointer, wherever an item
 * shows: any element marked `data-item-ref` (a notification, a sub-item, a
 * greeting chip, …), or the command palette's highlighted item. It listens in
 * the capture phase on window, ahead of a board row's or an item dialog's own
 * ⌘. (useCopyItemRef), so a sub-item hovered in its parent's dialog copies
 * the sub-item; with no marked item hovered, those handle it as before.
 */
export function CopyHoveredItemRef() {
  useEffect(() => {
    async function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented || e.isComposing) return;
      if (!matchesShortcut(e, { key: ".", mod: true })) return;
      // The palette's search box keeps focus while its items are picked.
      const inPalette = e.target instanceof Element && e.target.matches("[cmdk-input]");
      if (isEditableTarget(e.target) && !inPalette) return;
      // :hover matches the hovered element's ancestors too; the innermost
      // comes last in document order.
      const hovered = [...document.querySelectorAll<HTMLElement>("[data-item-ref]:hover")].at(-1);
      const el =
        hovered ??
        (inPalette
          ? document.querySelector<HTMLElement>('[cmdk-item][data-selected="true"][data-item-ref]')
          : null);
      const ref = el?.dataset.itemRef;
      if (!ref) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(ref);
      } catch {
        toast.error("Couldn't copy to the clipboard.");
        return;
      }
      toast.success(`Copied ${ref}`);
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
  return null;
}
