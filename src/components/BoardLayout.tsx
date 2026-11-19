import type { ComponentProps, ReactNode, Ref } from "react";
import { LogoMark } from "@/components/LogoMark";

// The board's frame, shared by the live board (Kanban, ProjectColumn) and its
// loading skeleton (BoardSkeleton), so the skeleton the app launches into
// lines up with the board that replaces it. Change the layout here, not in
// either consumer. No hooks or client APIs: the skeleton renders on the server.

export function BoardMain({ children }: { children: ReactNode }) {
  return <main className="flex h-dvh flex-col">{children}</main>;
}

/**
 * The top bar: logo and title on the left, then `nav` (the Brief, Board
 * and Done switch), and `children` on the right.
 */
export function BoardHeader({
  nav,
  children,
}: {
  nav?: ReactNode;
  children: ReactNode;
}) {
  return (
    // Tighter on phones so the views fit beside the header's buttons down to
    // 320px; px-3 lines the logo up with the views below.
    // The header is the app's own text; the avatar's initial is data-private.
    <div data-replay-safe data-board-header className="flex items-center justify-between gap-2 max-[360px]:gap-1.5 border-b border-neutral-200 px-3 py-2 sm:gap-3 sm:px-4 dark:border-neutral-800">
      <div className="flex shrink-0 items-center gap-2 self-stretch sm:gap-3">
        <h1 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <LogoMark />
          {/* The name gives way to the view switch on phones. */}
          <span className={nav ? "sr-only sm:not-sr-only" : undefined}>Sidetrack</span>
        </h1>
        {nav}
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5 max-[360px]:gap-1 sm:gap-3">{children}</div>
    </div>
  );
}

/** The horizontally scrolling row of project columns. */
export function BoardRail({
  ref,
  children,
}: {
  ref?: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  // On phones the sides are 4vw, the gap either side of a centred column, so
  // the first and last columns centre like the rest; with p-3 they'd stop
  // short, out of line with the Space tray's header, which assumes centred.
  // The bottom clears the home indicator in an installed iOS app; Space trays
  // (sections) clear it inside themselves instead, so their tint runs down
  // under it rather than stopping short above a bare band.
  return (
    <div
      ref={ref}
      className="kanban-rail flex flex-1 snap-x snap-mandatory gap-3 overflow-x-auto overflow-y-hidden p-3 max-sm:px-[4vw] pb-[max(0.75rem,env(safe-area-inset-bottom))] has-[>section]:pb-3"
    >
      {children}
    </div>
  );
}

/** One project column: a header row above a scrolling body. */
export function ColumnCard({
  header,
  children,
  ...props
}: Omit<ComponentProps<"article">, "className"> & { header: ReactNode }) {
  // pt-2, not p-3: the header row is 32px tall around a 24px icon, so the
  // icon already sits 4px down in it; this keeps it 12px from the top.
  // The header's side insets centre its icon over the item rows' 16px
  // checkboxes and its ⋯ menu over their 20px avatars: a row's border and p-2
  // put its checkbox centre 17px in (5px + half the 24px icon) and its avatar
  // centre 19px in (7px + half the menu's 24px button).
  // `data-drop-target`: a row from another list is being dragged over it
  // (DraggableItemList).
  return (
    <article
      className="flex h-full snap-center shrink-0 flex-col gap-1.5 overflow-hidden rounded-2xl border border-neutral-200 bg-white p-3 pt-2 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 w-[var(--column-width,92vw)] sm:w-80 transition-shadow data-[drop-target]:ring-2 data-[drop-target]:ring-neutral-900 dark:data-[drop-target]:ring-neutral-100"
      {...props}
    >
      <header className="flex items-start gap-2 shrink-0 pl-[5px] pr-[7px]">{header}</header>
      <div className="flex-1 min-h-0 -mx-3 overflow-y-auto px-3">{children}</div>
    </article>
  );
}
