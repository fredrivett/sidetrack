"use client";

import { useSyncExternalStore } from "react";
import { parseTheme, type Theme } from "@/lib/theme";

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

/**
 * The theme the user chose (src/lib/theme.ts), read from <html data-theme> so
 * every component sees a change at once. "system" on the server.
 */
export function useTheme(): Theme {
  return useSyncExternalStore(
    subscribe,
    () => parseTheme(document.documentElement.dataset.theme),
    () => "system",
  );
}
