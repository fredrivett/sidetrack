"use client"

import * as React from "react"
import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer"
import { XIcon } from "lucide-react"

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
  return (
    <IsDesktopContext.Provider value={isDesktop}>
      {isDesktop ? (
        <Dialog open={open} onOpenChange={onOpenChange}>
          {children}
        </Dialog>
      ) : (
        <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle>
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

export {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogCloseButton,
}
