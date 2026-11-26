"use client"

import { type ReactNode, useEffect, useRef, useState } from "react"

import { useHydrated } from "@/components/use-stored-state"
import { cn } from "@/lib/utils"

/** As long as the fold's transition (duration-300). */
const DURATION = 300

/**
 * A section's body, folding away under its heading. Rows 0fr to 1fr animates
 * to the content's own height. Folded, it's inert, so its contents leave the
 * tab order too, and once the fold has closed they unmount: a folded section
 * with hundreds of items costs nothing to render.
 *
 * Opening it brings what it shows into view: when the body would end below
 * what's on screen, as it does for a section at the foot of a list, its
 * scroll area glides down with it, as far as putting the fold's parent (the
 * section, heading first) at the top, and no further than the body needs;
 * a section above what's on screen, opened from elsewhere, is scrolled back
 * to. Scrolling meanwhile stops it. Its rows come in one by one as it does
 * (enter). A body that loads once opened, such as an item's activity, passes
 * `loading` until it's in: it opens on its loading state, and its rows come
 * in, and the scroll follows them, once they've arrived.
 *
 * Only opening it by hand does all this. One open from the start, including
 * one whose open state is stored in the browser (useStoredState), which
 * switches to it just after the page loads, is simply open.
 *
 * `className` styles the body; -mx-1 px-1 and pb-1 around it leave room for
 * its rows' focus rings.
 */
function Fold({
  id,
  open,
  loading = false,
  className,
  children,
}: {
  id?: string
  open: boolean
  loading?: boolean
  className?: string
  children: ReactNode
}) {
  const [mounted, setMounted] = useState(open)
  if (open && !mounted) setMounted(true)
  useEffect(() => {
    if (open) return
    const timer = setTimeout(() => setMounted(false), DURATION)
    return () => clearTimeout(timer)
  }, [open])

  // Not ready until a frame after the page has loaded: the stored state's
  // switch to its stored value, straight after, lands without a transition.
  const hydrated = useHydrated()
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!hydrated) return
    const frame = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(frame)
  }, [hydrated])

  const ref = useRef<HTMLDivElement>(null)
  const wasOpen = useRef(open)
  // Opened by hand, and not yet brought into view: from where its scroll
  // area was then, so a body still loading doesn't pull back someone who
  // has since scrolled away.
  const opening = useRef<number | null>(null)
  useEffect(() => {
    const fold = ref.current
    if (!fold) return
    if (open !== wasOpen.current) {
      opening.current = open && ready ? scrollArea(fold).area?.scrollTop ?? 0 : null
    }
    wasOpen.current = open
    if (opening.current === null || loading) return
    const from = opening.current
    opening.current = null
    enter(fold)
    if (scrollArea(fold).area?.scrollTop === from) return reveal(fold)
  }, [open, loading, ready])

  return (
    <div
      ref={ref}
      id={id}
      inert={!open}
      className={`grid ${
        ready ? "transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none" : ""
      } ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
    >
      <div className="-mx-1 min-h-0 overflow-hidden">
        <div className={cn("px-1 pb-1", className)}>{mounted && children}</div>
      </div>
    </div>
  )
}

/**
 * Brings the body's rows in one after another (stagger). A row is each of the
 * body's children, or each child of a list among them or of an element
 * marked `data-fold-rows`, such as the Brief's rows.
 */
function enter(fold: HTMLElement) {
  const body = fold.firstElementChild?.firstElementChild
  if (!body) return
  stagger(
    body.querySelectorAll(
      ":scope > :not(ul, ol, [data-fold-rows]), :scope > :is(ul, ol, [data-fold-rows]) > *",
    ),
  )
}

/**
 * Brings rows in one after another, each rising a little as it fades in, so
 * opening something reads as its rows arriving rather than a block
 * appearing. The first waits for the scroll to bring it on screen (glide);
 * after the eighth they all come in together, so a long body is no slower.
 */
function stagger(rows: Iterable<Element>) {
  if (reduced()) return
  let i = 0
  for (const row of rows) {
    // Optional: jsdom, which the tests run in, has no animations.
    row.animate?.([{ opacity: 0, translate: "0 8px" }, { opacity: 1, translate: "0 0" }], {
      duration: 260,
      delay: 100 + Math.min(i++, 8) * 45,
      easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
      fill: "backwards",
    })
  }
}

/**
 * Opens rows just put on the page under `anchor` the way a Fold opens its
 * body, for rows that can't sit in one, such as a board list's sub-items,
 * which are rows of the list itself: they grow from nothing, come in one by
 * one, and their scroll area glides down to them. Call it before the browser
 * paints them, as from a layout effect. Returns a cancel for the scroll.
 */
function openRows(anchor: HTMLElement, rows: HTMLElement[]) {
  if (!rows.length) return
  // Laid out for real while they open, where a page skips laying out what's
  // off screen until it's scrolled near (the Brief's rows, in globals.css),
  // so they're measured, and grow to, their real heights.
  for (const row of rows) row.dataset.opening = ""
  const end = Math.max(...rows.map((r) => r.getBoundingClientRect().bottom))
  // The gap the anchor gains below it, as the rows now follow it (space-y's
  // margins are below each row but the last), grows with the first row.
  const anchorGap = getComputedStyle(anchor).marginBottom
  rows.forEach((row, i) => {
    const height = `${row.getBoundingClientRect().height}px`
    const { marginTop, marginBottom } = getComputedStyle(row)
    const from = { height: "0px", marginTop: i ? "0px" : `-${anchorGap}`, marginBottom: "0px" }
    const grow = reduced()
      ? undefined
      : row.animate?.([from, { height, marginTop, marginBottom }], {
          duration: DURATION,
          // Tailwind's ease-out, as the Fold's rows.
          easing: "cubic-bezier(0, 0, 0.2, 1)",
        })
    // Clipped while it grows, so it doesn't spill over the row below.
    if (grow) row.style.overflow = "clip"
    const done = () => {
      row.style.removeProperty("overflow")
      delete row.dataset.opening
    }
    if (grow) grow.finished.then(done, done)
    else done()
  })
  stagger(rows)
  return glide(anchor, end)
}

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches

/**
 * Called as someone asks for rows to open under `el` (openRows), before
 * they're added: holds its scroll area where it is meanwhile. Otherwise the
 * browser's scroll anchoring, which keeps what's on screen in place as
 * content comes and goes, can take something below them as what to keep in
 * place, and scroll down by all they add before they've grown.
 */
function holdScroll(el: Element | null) {
  const { area } = el instanceof HTMLElement ? scrollArea(el) : { area: null }
  if (area) pauseAnchoring(area)
}

const resumes = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>()

/** Turns `area`'s scroll anchoring off for the length of an opening (glide's
 * longest), or longer if asked again meanwhile. */
function pauseAnchoring(area: HTMLElement) {
  clearTimeout(resumes.get(area))
  area.style.overflowAnchor = "none"
  resumes.set(
    area,
    setTimeout(() => area.style.removeProperty("overflow-anchor"), 1000),
  )
}

/**
 * What `el` scrolls in: its nearest scrolling ancestor, or the page, and
 * the part of it on screen, inside its scroll padding, which a page keeps
 * clear of what's stuck over it (see the source review's in globals.css).
 */
function scrollArea(el: HTMLElement) {
  let scroller: HTMLElement | null = el.parentElement
  while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) {
    scroller = scroller.parentElement
  }
  const area = scroller ?? (document.scrollingElement as HTMLElement | null)
  const box = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight }
  const style = area ? getComputedStyle(area) : null
  const view = {
    top: box.top + (parseFloat(style?.scrollPaddingTop ?? "") || 0),
    bottom: box.bottom - (parseFloat(style?.scrollPaddingBottom ?? "") || 0),
  }
  return { area, view }
}

/** Room left between the section and the scroll area's edges. */
const MARGIN = 8

/**
 * Scrolls `fold`'s scroll area, as it opens, so its body ends on screen,
 * without scrolling its parent's top out of view. Returns a cancel.
 */
function reveal(fold: HTMLElement) {
  const body = fold.firstElementChild?.firstElementChild
  const anchor = fold.parentElement
  if (!(body instanceof HTMLElement) || !anchor) return
  // The body's full height, while its row still starts at 0.
  return glide(anchor, fold.getBoundingClientRect().top + body.offsetHeight)
}

/**
 * Scrolls `anchor`'s scroll area, over the fold's transition, so what's
 * opening under it ends on screen (`end`, a viewport y, where it will end
 * once grown), as far as putting `anchor` at the top and no further; one
 * above what's on screen is scrolled back to. Returns a cancel.
 */
function glide(anchor: HTMLElement, end: number) {
  const { area, view } = scrollArea(anchor)
  if (!area) return

  const toTop = anchor.getBoundingClientRect().top - MARGIN - view.top
  const delta = toTop < 0 ? toTop : Math.min(end + MARGIN - view.bottom, toTop)
  if (delta === 0 || (toTop >= 0 && delta < 0)) return

  const from = area.scrollTop
  const to = from + delta
  if (reduced()) {
    area.scrollTop = to
    return
  }

  // Keeps pace with the fold's ease-out, frame by frame: until the body has
  // grown, the browser holds the scroll at the bottom, so it follows it down.
  pauseAnchoring(area)
  let frame = 0
  let last = NaN
  const start = performance.now()
  const step = (now: number) => {
    // A frame's time is when it started, which can be before `start`.
    const t = Math.min(1, Math.max(0, (now - start) / DURATION))
    area.scrollTop = from + delta * (1 - (1 - t) ** 3)
    // Past its time, on until it gets there: what's opening may have started
    // growing a frame or more after this did, as on a busy page, and only
    // lets the scroll reach its end once it has. Not once it stops moving,
    // as where there's less room below than the margin.
    const moved = area.scrollTop !== last
    last = area.scrollTop
    if (t < 1 || (moved && Math.abs(area.scrollTop - to) >= 1 && now - start < 1000)) {
      frame = requestAnimationFrame(step)
    } else stop()
  }
  frame = requestAnimationFrame(step)

  // The person scrolling themselves takes over.
  const events = ["wheel", "touchstart", "pointerdown", "keydown"] as const
  function stop() {
    cancelAnimationFrame(frame)
    for (const e of events) window.removeEventListener(e, stop, true)
  }
  for (const e of events) window.addEventListener(e, stop, { capture: true, passive: true })
  return stop
}

export { Fold, holdScroll, openRows }
