"use client"

import { useCallback, useSyncExternalStore } from "react"

/**
 * Tracks a CSS media query. SSR-safe: renders `defaultValue` on the server and
 * first client paint, then reflects the real match and updates as it changes.
 * Mirrors the responsive-default pattern used to switch a side panel (desktop)
 * for a bottom drawer (mobile).
 */
export function useMediaQuery(query: string, defaultValue = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query)
      mql.addEventListener("change", onChange)
      return () => mql.removeEventListener("change", onChange)
    },
    [query],
  )

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => defaultValue,
  )
}
