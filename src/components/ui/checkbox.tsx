"use client"

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import { cn } from "@/lib/utils"
import { CheckIcon } from "lucide-react"

// A task-completion circle (Things/Todoist/Reminders style) rather than a
// form checkbox: a thin outline at rest, a faint check on hover to preview the
// action, and a muted fill once done so completed rows recede with their
// struck-through titles. The ::after widens the hit area to 32px without
// changing layout.
function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "group/checkbox peer relative flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-full border-[1.5px] border-neutral-300 text-neutral-500 transition-colors outline-none after:absolute after:-inset-2 hover:border-neutral-500 focus-visible:ring-3 focus-visible:ring-ring/50 data-disabled:cursor-not-allowed data-disabled:opacity-50 data-checked:border-neutral-400 data-checked:bg-neutral-400 data-checked:text-white dark:border-neutral-600 dark:text-neutral-400 dark:hover:border-neutral-400 dark:data-checked:border-neutral-600 dark:data-checked:bg-neutral-600 dark:data-checked:text-neutral-900",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        keepMounted
        data-slot="checkbox-indicator"
        className="grid place-content-center opacity-0 transition-opacity group-hover/checkbox:opacity-70 data-checked:opacity-100 [&>svg]:size-2.5"
      >
        <CheckIcon strokeWidth={3.5} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
