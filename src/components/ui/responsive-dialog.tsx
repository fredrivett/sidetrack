"use client"

import * as React from "react"
import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer"
import { ChevronLeftIcon, XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@/components/ui/drawer"
import { useMediaQuery } from "@/components/ui/use-media-query"

// Centred modal on desktop, swipe-to-dismiss bottom drawer on mobile
// (shadcn's responsive dialog pattern). The root picks once; the parts below
// read that choice so callers write one body for both.
const IsDesktopContext = React.createContext(true)

function ResponsiveDialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}) {
  const matchesDesktop = useMediaQuery("(min-width: 768px)", true)
  // Follow the width only while closed. Swapping Dialog for Drawer remounts
  // the body, so crossing 768px while open (a phone rotating to landscape)
  // would throw away half-typed input.
  const [isDesktop, setIsDesktop] = React.useState(matchesDesktop)
  if (!open && isDesktop !== matchesDesktop) setIsDesktop(matchesDesktop)
  // Toasts sit outside the dialog but over it, not behind it, so pressing
  // one (such as copying the ref from New item's "Added" toast) isn't a
  // press outside that closes the dialog.
  function change(
    next: boolean,
    details: {
      reason: string
      event: Event
      cancel: () => void
      allowPropagation: () => void
    }
  ) {
    if (
      details.reason === "outside-press" &&
      details.event.target instanceof Element &&
      details.event.target.closest("[data-sonner-toaster]")
    ) {
      details.cancel()
      return
    }
    // Escape during a keyboard drag puts the row back: it goes on to
    // dnd-kit and leaves the dialog open.
    if (details.reason === "escape-key" && pickedUp(details.event)) {
      details.cancel()
      details.allowPropagation()
      return
    }
    onOpenChange(next)
  }
  return (
    <IsDesktopContext.Provider value={isDesktop}>
      {isDesktop ? (
        <Dialog open={open} onOpenChange={change}>
          {children}
        </Dialog>
      ) : (
        <Drawer open={open} onOpenChange={change} showSwipeHandle>
          {/* Keeps the focused field above the on-screen keyboard by
              scrolling the drawer's body. */}
          <DrawerPrimitive.VirtualKeyboardProvider>
            {children}
          </DrawerPrimitive.VirtualKeyboardProvider>
        </Drawer>
      )}
    </IsDesktopContext.Provider>
  )
}

// A row picked up from the keyboard to drag (dnd-kit's sortable rows, such as
// the item's checklist): the keys that move or drop it are dnd-kit's, which
// listens on the document.
const pickedUp = (event: Event | React.KeyboardEvent) =>
  event.target instanceof Element &&
  event.target.closest('[aria-roledescription="sortable"][aria-pressed="true"]') !== null

// Base UI's popup stops the arrow keys there, for its own lists' focus,
// which would keep a picked-up row from moving.
function leaveDragKeys(
  e: React.KeyboardEvent & { preventBaseUIHandler?: () => void }
) {
  if (pickedUp(e)) e.preventBaseUIHandler?.()
}

/** A column: callers give it a fixed header, a scrolling body
 * (`min-h-0 flex-1 overflow-y-auto`) and a fixed footer. */
function ResponsiveDialogContent({
  className,
  children,
  initialFocus,
}: {
  className?: string
  children: React.ReactNode
  initialFocus?: React.RefObject<HTMLElement | null>
}) {
  const isDesktop = React.useContext(IsDesktopContext)
  return isDesktop ? (
    <DialogContent
      showCloseButton={false}
      initialFocus={initialFocus}
      onKeyDown={leaveDragKeys}
      className={cn(
        "flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-lg",
        className
      )}
    >
      {children}
    </DialogContent>
  ) : (
    <DrawerContent
      initialFocus={initialFocus}
      onKeyDown={leaveDragKeys}
      // Lift the whole drawer above the on-screen keyboard. The keyboard
      // provider scrolls a field into view within the body, but undoes iOS's
      // own page scroll, so without this a short drawer (Share, New list)
      // stays entirely under the keyboard.
      className={cn("pb-[var(--drawer-keyboard-inset,0px)]", className)}
    >
      {children}
    </DrawerContent>
  )
}

function ResponsiveDialogTitle({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  const Title = React.useContext(IsDesktopContext) ? DialogTitle : DrawerTitle
  return (
    <Title className={cn("text-left text-base leading-normal", className)}>
      {children}
    </Title>
  )
}

function ResponsiveDialogDescription({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  const Description = React.useContext(IsDesktopContext)
    ? DialogDescription
    : DrawerDescription
  return <Description className={className}>{children}</Description>
}

// How views swap: the dialog's edge and both views move together, easing in
// and out so the resize neither snaps nor crawls.
const SWAP = { duration: 320, easing: "cubic-bezier(0.4, 0, 0.2, 1)" }

/**
 * Swaps the dialog between views, such as a list's details and one of its
 * labels: give each its own header, body and footer as children, and a
 * `view` naming it. On a change the views move side by side, a page at a
 * time: going `forward` the old one slides off to the left as the new one
 * comes in from the right, and going back the reverse, while the dialog
 * eases to the new view's height. The first view doesn't animate, and
 * nothing does with reduced motion.
 */
function ResponsiveDialogViews({
  view,
  direction,
  children,
}: {
  view: string
  direction: "forward" | "back"
  children: React.ReactNode
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const current = React.useRef<HTMLDivElement | null>(null)
  // The height the dialog last settled at, kept by a ResizeObserver, which
  // reports after the layout effect below: so on a change it still holds
  // the old view's height, whatever made that view grow or shrink.
  const settled = React.useRef(0)
  const shown = React.useRef(view)
  const running = React.useRef<Animation[]>([])
  // A copy of the view on its way out, taken as React removes it (the ref
  // cleanup runs while it's still laid out), to slide away beside the new one.
  // A copy doesn't keep scroll positions, so they're noted to put back.
  const leaving = React.useRef<{
    node: HTMLElement
    height: number
    scrolled: [number, number][]
  } | null>(null)
  const viewRef = React.useCallback((el: HTMLDivElement | null) => {
    current.current = el
    if (!el) return
    return () => {
      const node = el.cloneNode(true) as HTMLElement
      node.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"))
      const scrolled: [number, number][] = []
      el.querySelectorAll("*").forEach((n, i) => {
        if (n.scrollTop) scrolled.push([i, n.scrollTop])
      })
      leaving.current = { node, height: el.getBoundingClientRect().height, scrolled }
    }
  }, [])

  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      if (running.current.length === 0) settled.current = el.offsetHeight
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  React.useLayoutEffect(() => {
    const el = ref.current
    const next = current.current
    const out = leaving.current
    leaving.current = null
    if (!el || !next || shown.current === view) return
    shown.current = view
    // Swapped again part-way: start from where the last swap had got to.
    const from = running.current.length
      ? el.getBoundingClientRect().height
      : settled.current
    for (const a of running.current) a.cancel()
    el.querySelectorAll("[data-leaving]").forEach((n) => n.remove())
    running.current = []
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return

    // The new view keeps the height it settles at while the dialog's edge
    // eases to it, rather than being squeezed (and its body scrolling) on
    // the way, so a body it scrolled to where it was stays there.
    const to = el.offsetHeight
    Object.assign(next.style, { flex: "none", height: `${to}px` })
    // A whole page width, so the two views stay edge to edge.
    const dx = direction === "forward" ? "100%" : "-100%"
    const animations = [
      el.animate([{ height: `${from}px` }, { height: `${to}px` }], SWAP),
      next.animate([{ transform: `translateX(${dx})` }, { transform: "none" }], SWAP),
    ]
    if (out) {
      const { node, height, scrolled } = out
      node.dataset.leaving = ""
      node.inert = true
      node.setAttribute("aria-hidden", "true")
      Object.assign(node.style, {
        position: "absolute",
        inset: "0 0 auto 0",
        height: `${height}px`,
        pointerEvents: "none",
      })
      el.append(node)
      const all = node.querySelectorAll("*")
      for (const [i, top] of scrolled) all[i].scrollTop = top
      const away = direction === "forward" ? "-100%" : "100%"
      animations.push(
        node.animate([{ transform: "none" }, { transform: `translateX(${away})` }], {
          ...SWAP,
          fill: "forwards",
        })
      )
    }
    running.current = animations
    void Promise.all(animations.map((a) => a.finished)).then(
      () => {
        if (running.current !== animations) return
        running.current = []
        Object.assign(next.style, { flex: "", height: "" })
        out?.node.remove()
        settled.current = el.offsetHeight
      },
      // Cancelled by the next swap, which tidies up.
      () => {
        Object.assign(next.style, { flex: "", height: "" })
      }
    )
  }, [view, direction])

  return (
    // Not flex-1: its height, while it eases, sizes the dialog.
    <div ref={ref} className="relative flex min-h-0 shrink flex-col overflow-hidden">
      <div key={view} ref={viewRef} className="flex min-h-0 flex-1 flex-col">
        {children}
      </div>
    </div>
  )
}

/** The ✕ button. Place it in the header row, so it lines up in both forms
 * (the drawer's swipe handle sits above the header). */
function ResponsiveDialogCloseButton({ className }: { className?: string }) {
  const Close = React.useContext(IsDesktopContext) ? DialogClose : DrawerClose
  return (
    <Close
      render={<Button variant="ghost" size="icon-sm" className={className} />}
    >
      <XIcon />
      <span className="sr-only">Close</span>
    </Close>
  )
}

/** "‹ Where it goes", first in a view's header row: back to the view this
 * one was opened from (ResponsiveDialogViews). Focused as the view comes in,
 * so the keyboard goes back as easily as it came. */
function ResponsiveDialogBackButton({
  label,
  onClick,
  className,
}: {
  label: string
  onClick: () => void
  className?: string
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      autoFocus
      onClick={onClick}
      aria-label={`Back to ${label}`}
      className={cn("-ml-2 min-w-0 shrink text-neutral-500", className)}
    >
      <ChevronLeftIcon />
      <span className="truncate">{label}</span>
    </Button>
  )
}

export {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogCloseButton,
  ResponsiveDialogBackButton,
  ResponsiveDialogViews,
}
