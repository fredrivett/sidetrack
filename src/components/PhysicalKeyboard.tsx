"use client";

import { useEffect } from "react";
import { isEditableTarget } from "@/lib/keyboard";

// Marks <html data-physical-keyboard> on the first key press outside a text
// field, which only a physical keyboard can send: the on-screen keyboard opens
// only for a focused field. Touch devices hide shortcut hints (ui/kbd.tsx)
// until then, so a tablet with a keyboard but no trackpad gets them back.
export function PhysicalKeyboard() {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isEditableTarget(e.target)) return;
      document.documentElement.dataset.physicalKeyboard = "";
      window.removeEventListener("keydown", onKeyDown, true);
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
  return null;
}
