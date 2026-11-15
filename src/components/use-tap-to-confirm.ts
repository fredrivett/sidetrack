"use client";

import { useEffect, useState } from "react";

/** How long an armed button waits for its second tap before it disarms. */
const ARMED_MS = 4000;

/** The armed look for a destructive menu item: filled red, as in ItemRow. */
export const ARMED_MENU_ITEM =
  "bg-destructive! text-white! focus:bg-destructive! focus:text-white! *:[svg]:text-white!";

/**
 * Tap-to-confirm for destructive actions: the first tap arms the button,
 * which then says "Confirm …?", and a second tap runs it. It disarms after a
 * few seconds, or on `reset` (call it when the menu or dialog closes). `key`
 * tells apart several buttons sharing one hook, such as one per row.
 */
export function useTapToConfirm() {
  const [armed, setArmed] = useState<string | null>(null);
  useEffect(() => {
    if (armed === null) return;
    const t = setTimeout(() => setArmed(null), ARMED_MS);
    return () => clearTimeout(t);
  }, [armed]);
  return {
    isArmed: (key = "") => armed === key,
    confirm(run: () => void, key = "") {
      if (armed !== key) {
        setArmed(key);
        return;
      }
      setArmed(null);
      run();
    },
    reset: () => setArmed(null),
  };
}
