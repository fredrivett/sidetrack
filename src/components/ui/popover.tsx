"use client";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { type RefObject, useCallback, useState } from "react";

import { useMediaQuery } from "@/components/ui/use-media-query";
import { cn } from "@/lib/utils";

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
  align = "center",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  anchor,
  className,
  onFocus,
  onBlur,
  initialFocus,
  ...props
}: Omit<PopoverPrimitive.Popup.Props, "ref" | "initialFocus"> &
  Pick<
    PopoverPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "anchor"
  > & {
    /** Its primary field, focused as it opens (on phones too, keyboard and
     * all), so the person can type straight away. `null` when it has none,
     * with a comment saying why: then its first control is focused, or on
     * touch nothing, so no keyboard comes up. */
    initialFocus: RefObject<HTMLElement | null> | null;
  }) {
  // On a phone, typing in a popover's field (a search, a date) brings up the
  // keyboard, and iOS pans the page to keep the field above it, which can
  // carry the trigger off screen. Meanwhile the popover is sticky: it stays
  // in what's visible, over its trigger if need be, and scrolls when that's
  // less than its height, rather than following the trigger off the top or
  // running under the keyboard. Only meanwhile, as sticky also lets it cover
  // its trigger, and keeps it on screen when its trigger scrolls away.
  const touch = useMediaQuery("(hover: none) and (pointer: coarse)");
  const [typing, setTyping] = useState(false);
  // Closing removes the field without a blur, and this component outlives
  // the popup, so typing ends with the popup too: it reopens not sticky.
  const popupRef = useCallback((popup: HTMLDivElement | null) => {
    const stop = keepFieldInView(popup);
    return () => {
      stop?.();
      setTyping(false);
    };
  }, []);
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        sticky={touch && typing}
        className="isolate z-50 outline-none"
        anchor={anchor}
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            "z-50 max-h-(--available-height) overflow-x-hidden overflow-y-auto overscroll-contain origin-(--transform-origin) rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 outline-none data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className,
          )}
          onFocus={(e) => {
            setTyping(isField(e.target));
            onFocus?.(e);
          }}
          onBlur={(e) => {
            // Typing goes on only if focus moves to another of its fields.
            const next = e.relatedTarget;
            setTyping(
              isField(next) && e.currentTarget.contains(next as Node),
            );
            onBlur?.(e);
          }}
          {...props}
          initialFocus={initialFocus ?? undefined}
          ref={popupRef}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

const isField = (el: EventTarget | null) =>
  el instanceof HTMLInputElement ||
  el instanceof HTMLTextAreaElement ||
  (el instanceof HTMLElement && el.isContentEditable);

/** When the popover shrinks, such as to fit above the keyboard that typing
 * in it brought up, scrolls it to keep the field being typed in showing. */
function keepFieldInView(popup: HTMLDivElement | null) {
  if (!popup) return;
  const observer = new ResizeObserver(() => {
    const field = popup.ownerDocument.activeElement;
    if (!(field instanceof HTMLElement) || !popup.contains(field)) return;
    const box = popup.getBoundingClientRect();
    const rect = field.getBoundingClientRect();
    if (rect.bottom > box.bottom) popup.scrollTop += rect.bottom - box.bottom + 8;
    else if (rect.top < box.top) popup.scrollTop -= box.top - rect.top + 8;
  });
  observer.observe(popup);
  return () => observer.disconnect();
}

export { Popover, PopoverTrigger, PopoverContent };
