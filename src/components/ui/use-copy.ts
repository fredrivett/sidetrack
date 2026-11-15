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
  const [copied, setCopied] = useState(false)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const copy = useCallback(async () => {
    try {
      // Throws when the clipboard API is missing (insecure context) too.
      await navigator.clipboard.writeText(text)
    } catch {
      setCopied(false)
      toast.error("Couldn't copy to the clipboard.")
      return false
    }
    setCopied(true)
    if (resetTimer.current) clearTimeout(resetTimer.current)
    resetTimer.current = setTimeout(() => setCopied(false), 1500)
    return true
  }, [text])

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current)
    },
    []
  )

  return { copied, copy }
}
