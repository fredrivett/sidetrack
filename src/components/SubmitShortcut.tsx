"use client";

import { useEffect } from "react";
import { matchesShortcut } from "@/lib/keyboard";

// ⌘Enter (Ctrl+Enter elsewhere) in any form presses its main button, the
// first submit button, as Enter does from a single-line field, so it also
// works from a textarea. A disabled or saving (aria-disabled) button ignores
// it, as it would a click. Fields that handle ⌘Enter themselves, such as a
// comment box, prevent the default and are left alone.
export function SubmitShortcut() {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented || e.isComposing) return;
      if (!matchesShortcut(e, { key: "Enter", mod: true })) return;
      const form = e.target instanceof Element ? e.target.closest("form") : null;
      if (!form) return;
      const button = [...form.elements].find(
        (el): el is HTMLButtonElement | HTMLInputElement =>
          (el instanceof HTMLButtonElement || el instanceof HTMLInputElement) &&
          el.type === "submit",
      );
      e.preventDefault();
      if (!button || button.disabled || button.getAttribute("aria-disabled") === "true") {
        return;
      }
      form.requestSubmit(button);
    }
    // Bubbling on document runs after React's handlers, so theirs come first.
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
  return null;
}
