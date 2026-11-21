"use client"

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import { cn } from "@/lib/utils"
import { CheckIcon } from "lucide-react"

// A task-completion circle (Things/Todoist/Reminders style) rather than a
// form checkbox: a thin outline at rest, a faint check on hover to preview the
// action, and a muted fill once done so completed rows recede with their
// struck-through titles. An invisible switch (below) widens the hit area to
// 32px without changing layout.
const root = (el: HTMLElement) =>
  el.closest<HTMLElement>('[data-slot="checkbox"]')

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "group/checkbox peer relative flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-full border-[1.5px] border-neutral-300 text-neutral-500 transition-colors outline-none hover:border-neutral-500 focus-visible:ring-3 focus-visible:ring-ring/50 data-disabled:cursor-not-allowed data-disabled:opacity-50 data-checked:border-neutral-400 data-checked:bg-neutral-400 data-checked:text-white dark:border-neutral-600 dark:text-neutral-400 dark:hover:border-neutral-400 dark:data-checked:border-neutral-600 dark:data-checked:bg-neutral-600 dark:data-checked:text-neutral-900",
        className
      )}
      {...props}
    >
      {/* Always there, shown by the root's data-checked: a plain span, not
          CheckboxPrimitive.Indicator, which watches for an exit animation on
          every unticked box as it mounts (getAnimations, then a re-render),
          a cost each board row paid on every view switch. */}
      <span
        data-slot="checkbox-indicator"
        className="grid place-content-center opacity-0 transition-opacity group-hover/checkbox:opacity-70 group-data-checked/checkbox:opacity-100 [&>svg]:size-2.5"
      >
        <CheckIcon strokeWidth={3.5} />
      </span>
      {/* A haptic tick on iPhone, which has no vibrate API: iOS 18+ plays one
          only when the user's own tap toggles a native switch (earlier iOS
          just toggles it silently). So an invisible switch is the 32px hit
          area. It must keep its native look (opacity, not appearance-none)
          and its click must not reach the Root, whose onClick
          preventDefaults it (cancelling the toggle). The Root then gets the
          click instead, and focus too, so it never rests on this hidden
          input. Android has no switch haptic but does have vibrate (iOS
          doesn't), so it ticks from here. */}
      <input
        type="checkbox"
        {...{ switch: "" }}
        aria-hidden
        tabIndex={-1}
        disabled={props.disabled || props.readOnly}
        className="absolute -inset-2 m-0 size-8 cursor-pointer opacity-0 disabled:cursor-not-allowed"
        onFocus={(e) => root(e.currentTarget)?.focus()}
        onClick={(e) => {
          e.stopPropagation()
          navigator.vibrate?.(10)
          root(e.currentTarget)?.click()
        }}
      />
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
