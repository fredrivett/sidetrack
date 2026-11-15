"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"

/**
 * Copy `text` to the clipboard. `copied` is true for 1.5s after a copy, so
 * the control the user clicked can show "✓ Copied" in place: inline feedback,
 * not a toast. A failed copy has no control state to show, so it toasts.
 * `copy()` resolves to whether the copy succeeded.
 */
export function useCopy(text: string) {
  // The text last copied, not a boolean, so a control whose value changes
  // (a new API key) doesn't claim "Copied" for a value never copied.
  const [copiedText, setCopiedText] = useState<string | null>(null)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const copy = useCallback(async () => {
    try {
      // Throws when the clipboard API is missing (insecure context) too.
      await navigator.clipboard.writeText(text)
    } catch {
      setCopiedText(null)
      toast.error("Couldn't copy to the clipboard.")
      return false
    }
    setCopiedText(text)
    if (resetTimer.current) clearTimeout(resetTimer.current)
    resetTimer.current = setTimeout(() => setCopiedText(null), 1500)
    return true
  }, [text])

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current)
    },
    []
  )

  return { copied: copiedText === text, copy }
}
