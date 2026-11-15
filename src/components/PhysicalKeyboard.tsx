"use client";

import { useEffect } from "react";
import { isEditableTarget, PHYSICAL_KEYBOARD_STORAGE_KEY } from "@/lib/keyboard";

// Marks <html data-physical-keyboard> on the first key press outside a text
// field, which only a physical keyboard can send: the on-screen keyboard opens
// only for a focused field. Touch devices hide shortcut hints (ui/kbd.tsx)
// until then, so a tablet with a keyboard but no trackpad gets them back. The
// press is remembered in localStorage, and the root layout's inline script
// restores the mark before first paint so the hints don't flash in on reload.
export function PhysicalKeyboard() {
  useEffect(() => {
    if ("physicalKeyboard" in document.documentElement.dataset) return;
    function onKeyDown(e: KeyboardEvent) {
      if (isEditableTarget(e.target)) return;
      document.documentElement.dataset.physicalKeyboard = "";
      window.removeEventListener("keydown", onKeyDown, true);
      try {
        localStorage.setItem(PHYSICAL_KEYBOARD_STORAGE_KEY, "1");
      } catch {
        // Storage blocked: the hints still show for this page load.
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
  return null;
}
