"use client"

import { Check, Copy } from "lucide-react"
import type { ComponentProps } from "react"

import { Button } from "@/components/ui/button"
import { useCopy } from "@/components/ui/use-copy"

/**
 * A button that copies `value` and swaps its icon (and label, if given) to
 * "✓ Copied" for a moment. Children are the idle label; omit them for an
 * icon-only button and pass an `aria-label`, which reads "Copied" meanwhile.
 */
function CopyButton({
  value,
  children,
  variant = "outline",
  size = "sm",
  "aria-label": ariaLabel,
  ...props
}: Omit<ComponentProps<typeof Button>, "value" | "onClick"> & {
  value: string
}) {
  const { copied, copy } = useCopy(value)
  return (
    <Button
      variant={variant}
      size={size}
      {...props}
      aria-label={copied && ariaLabel ? "Copied" : ariaLabel}
      onClick={() => void copy()}
    >
      {copied ? <Check /> : <Copy />}
      {children !== undefined && (copied ? "Copied" : children)}
    </Button>
  )
}

export { CopyButton }
