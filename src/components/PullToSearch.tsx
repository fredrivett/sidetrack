"use client";

import { Search } from "lucide-react";
import { useEffect, useRef } from "react";

/** Finger travel, in px, past which letting go opens the palette. */
const THRESHOLD = 72;
/** dnd-kit's TouchSensor starts a drag after a 200ms hold (DraggableItemList),
 * so a touch that hasn't moved by then is a drag, not a pull. */
const DRAG_HOLD_MS = 200;

/** The nearest ancestor that scrolls vertically, if any. */
function verticalScroller(el: Element | null): HTMLElement | null {
  for (let node = el; node && node !== document.body; node = node.parentElement) {
    if (!(node instanceof HTMLElement)) continue;
    const { overflowY } = getComputedStyle(node);
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      node.scrollHeight > node.clientHeight
    ) {
      return node;
    }
  }
  return null;
}

/**
 * Pull down from the top of the board (or Today, or No date) to open the
 * command palette, like Things' Quick Find. A pull only starts when whatever
 * is under the finger is already scrolled to the top, so ordinary scrolling
 * and sideways swipes between lists are untouched. Touch-only: touch events
 * never fire for a mouse.
 *
 * The listeners are passive and the hint is moved by writing its style
 * directly, so the board doesn't re-render on every touchmove. Its fade and
 * slide follow the finger with no transition, while crossing the threshold
 * flips data-ready, whose colour, scale and label changes animate in CSS.
 */
export function PullToSearch({ onOpen }: { onOpen: () => void }) {
  const hintRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLSpanElement>(null);
  const onOpenRef = useRef(onOpen);
  useEffect(() => {
    onOpenRef.current = onOpen;
  }, [onOpen]);

  useEffect(() => {
    // "pending" until the first real move decides whether this touch is a
    // pull; "pulling" once it is; null when it isn't (or no touch is down).
    let state: "pending" | "pulling" | null = null;
    let startX = 0;
    let startY = 0;
    let startedAt = 0;
    let distance = 0;

    function place(hint: HTMLElement, progress: number) {
      hint.style.opacity = String(progress);
      hint.style.transform = `translate(-50%, ${(progress - 1) * 16}px)`;
    }

    /** Flips the hint's state and sizes the labels' box to the one shown,
     * so the pill eases between their widths as they swap. */
    function setReady(hint: HTMLElement, ready: boolean) {
      if (hint.dataset.ready === String(ready)) return;
      hint.dataset.ready = String(ready);
      // A tick as the pull arms, on Android: Safari has no vibrate, and Chrome
      // refuses it until the page has been tapped (a pull isn't a tap).
      if (ready && navigator.userActivation?.hasBeenActive) navigator.vibrate?.(10);
      const labels = labelsRef.current;
      const shown = ready ? labels?.lastElementChild : labels?.firstElementChild;
      if (labels && shown instanceof HTMLElement) {
        labels.style.width = `${shown.offsetWidth}px`;
      }
    }

    function show(d: number) {
      const hint = hintRef.current;
      if (!hint) return;
      place(hint, Math.min(d / THRESHOLD, 1));
      setReady(hint, d >= THRESHOLD);
    }

    function reset() {
      state = null;
      distance = 0;
      const hint = hintRef.current;
      if (!hint) return;
      hint.style.transition = "opacity 150ms, transform 150ms";
      // Leaves data-ready alone, so the hint fades out still saying what the
      // release did instead of flipping back to "Pull to search" on the way.
      place(hint, 0);
    }

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length !== 1) return reset();
      // While a dialog, menu or the palette itself is open, pulls are its.
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      const target = e.target instanceof Element ? e.target : null;
      const scroller = verticalScroller(target);
      if (scroller && scroller.scrollTop > 0) return;
      state = "pending";
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      startedAt = e.timeStamp;
      if (hintRef.current) {
        hintRef.current.style.transition = "none";
        setReady(hintRef.current, false);
      }
    }

    function onTouchMove(e: TouchEvent) {
      if (!state) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (state === "pending") {
        // dnd-kit tolerates 5px of movement before its hold delay runs out.
        if (Math.hypot(dx, dy) < 6) return;
        // Held long enough to pick up an item, swiping up, or mostly
        // sideways (between lists): not a pull.
        if (e.timeStamp - startedAt >= DRAG_HOLD_MS || dy <= 0 || Math.abs(dx) > dy) {
          return reset();
        }
        state = "pulling";
      }
      distance = Math.max(dy, 0);
      show(distance);
    }

    function onTouchEnd() {
      const open = state === "pulling" && distance >= THRESHOLD;
      reset();
      if (!open) return;
      // iOS only raises the keyboard for a focus made inside the gesture, and
      // the palette focuses its input a frame later. So focus a throwaway
      // input now: the keyboard stays up as focus moves on to the palette's,
      // and removing it on blur leaves nothing for focus to return to.
      const proxy = document.createElement("input");
      // Named, not aria-hidden: it holds focus until the palette's input
      // takes it, and a focused element must stay exposed to screen readers.
      proxy.setAttribute("aria-label", "Search");
      proxy.tabIndex = -1;
      // 16px stops iOS zooming in on focus.
      proxy.style.cssText = "position:fixed;top:0;left:0;opacity:0;font-size:16px";
      proxy.addEventListener("blur", () => proxy.remove(), { once: true });
      document.body.append(proxy);
      proxy.focus({ preventScroll: true });
      onOpenRef.current();
    }

    const opts = { passive: true };
    document.addEventListener("touchstart", onTouchStart, opts);
    document.addEventListener("touchmove", onTouchMove, opts);
    document.addEventListener("touchend", onTouchEnd, opts);
    document.addEventListener("touchcancel", reset, opts);
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", reset);
    };
  }, []);

  // Both labels share one grid cell, so the swap slides one out as the other
  // comes in; setReady sizes the cell to whichever is shown. The cell clips
  // them, not the pill: a rounded clip misses the labels while they animate.
  const label =
    "col-start-1 row-start-1 w-max transition-[opacity,translate] duration-200 ease-out";
  return (
    <div
      ref={hintRef}
      aria-hidden
      className="group pointer-events-none fixed top-[calc(3.75rem+env(safe-area-inset-top))] left-1/2 z-40 opacity-0"
      style={{ transform: "translate(-50%, -16px)" }}
    >
      <div className="flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-500 shadow-sm transition-[background-color,border-color,color,scale] duration-200 ease-out motion-safe:group-data-[ready=true]:scale-105 group-data-[ready=true]:border-neutral-900 group-data-[ready=true]:bg-neutral-900 group-data-[ready=true]:text-white dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400 dark:group-data-[ready=true]:border-neutral-100 dark:group-data-[ready=true]:bg-neutral-100 dark:group-data-[ready=true]:text-neutral-900">
        <Search className="size-3.5" />
        <span
          ref={labelsRef}
          className="grid overflow-hidden transition-[width] duration-200 ease-out motion-reduce:transition-none"
        >
          <span
            className={`${label} group-data-[ready=true]:opacity-0 motion-safe:group-data-[ready=true]:-translate-y-full`}
          >
            Pull to search
          </span>
          <span
            className={`${label} opacity-0 group-data-[ready=true]:opacity-100 motion-safe:translate-y-full motion-safe:group-data-[ready=true]:translate-y-0`}
          >
            Release to search
          </span>
        </span>
      </div>
    </div>
  );
}
