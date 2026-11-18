import { BoardHeader, BoardMain, BoardRail, ColumnCard } from "./BoardLayout";

// The board while it loads: the real frame from BoardLayout with grey
// placeholders sized to the elements they stand in for, so nothing shifts when
// the board replaces it. Shown by the board route's loading.tsx and by the
// service-worker-cached /launch page the installed app opens into.

/** A grey placeholder block; size and shape come from `className`. */
function Bone({ className }: { className: string }) {
  return (
    <span
      className={`block rounded bg-neutral-200 motion-safe:animate-pulse dark:bg-neutral-800 ${className}`}
    />
  );
}

/** Title widths per placeholder item, one list per column. */
const COLUMNS = [
  ["w-3/4", "w-1/2", "w-2/3", "w-4/5", "w-3/5"],
  ["w-2/3", "w-4/5", "w-1/2"],
  ["w-3/5", "w-3/4", "w-2/3", "w-1/2"],
];

export function BoardSkeleton() {
  return (
    <BoardMain>
      <BoardHeader nav={<Bone className="h-7 w-[96px] rounded-md sm:w-[241px] touch:h-9 touch:w-[102px] touch:sm:w-[256px]" />}>
        {/* List count, Activity, Account. */}
        <Bone className="hidden h-4 w-8 md:block" />
        <Bone className="h-7 w-9 rounded-lg sm:w-[74px] touch:h-9 touch:w-[42px] touch:sm:w-[80px]" />
        <Bone className="h-7 w-9 rounded-lg sm:w-[90px] touch:h-9 touch:w-[42px] touch:sm:w-[96px]" />
      </BoardHeader>
      <BoardRail>
        <span className="sr-only" role="status">
          Loading lists…
        </span>
        {COLUMNS.map((titles, col) => (
          <ColumnCard
            key={col}
            aria-hidden="true"
            header={
              <>
                {/* One 32px row, as in ProjectColumn: the icon inside its p-1
                    button (pulled left by that padding), the name inside its h-8 edit box (pulled left by
                    the box's border and padding) followed by the prefix, then
                    the menu. A list's status and Shared badges get a second
                    row only when they apply, so most lists have none. */}
                <span className="-ml-1 p-1">
                  <Bone className="size-6 rounded-[4px]" />
                </span>
                <div className="-ml-[7px] flex h-8 min-w-0 flex-1 items-center gap-1">
                  <span className="px-[7px]">
                    <Bone className="h-4 w-24" />
                  </span>
                  <Bone className="h-[19px] w-8 shrink-0" />
                </div>
                <span className="h-8 w-6 shrink-0" />
              </>
            }
          >
            {/* No summary line: like the status badges, a list's summary
                only shows once written, so most lists have none. */}
            <div className="space-y-1.5 pt-1.5">
              {titles.map((width, row) => (
                // A one-line item row: checkbox, title, then the space of the
                // assignee avatar. Each is one 20px title-line tall, as in
                // ItemRow.
                <div
                  key={row}
                  className="flex items-start gap-2 rounded-lg border border-neutral-200 bg-white p-2 dark:border-neutral-800 dark:bg-neutral-900"
                >
                  <Bone className="mt-0.5 size-4 shrink-0 rounded-full!" />
                  <span className="block flex-1 py-1">
                    <Bone className={`h-3 ${width}`} />
                  </span>
                  <span className="size-5 shrink-0" />
                </div>
              ))}
            </div>
          </ColumnCard>
        ))}
        {/* The frame of AddProjectButton, which always ends the rail. */}
        <span
          aria-hidden="true"
          className="h-full min-h-32 w-72 shrink-0 snap-center rounded-2xl border-2 border-dashed border-neutral-300 dark:border-neutral-700"
        />
      </BoardRail>
    </BoardMain>
  );
}
