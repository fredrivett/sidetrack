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
      <BoardHeader>
        {/* List count, Activity, Account. */}
        <Bone className="h-4 w-14" />
        <Bone className="h-[26px] w-[61px] rounded-md" />
        <Bone className="h-7 w-[72px] rounded-lg" />
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
                {/* Icon (inside its p-1 button), name, status and prefix, menu. */}
                <span className="p-1">
                  <Bone className="size-[22px] rounded-md" />
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <span className="block py-1">
                    <Bone className="h-4 w-32" />
                  </span>
                  <div className="flex items-center gap-1.5">
                    <Bone className="h-5 w-16 rounded-full" />
                    <Bone className="h-[19px] w-8" />
                  </div>
                </div>
                <span className="h-8 w-6 shrink-0" />
              </>
            }
          >
            {/* Summary line. */}
            <span className="block py-1">
              <Bone className="h-3 w-1/2" />
            </span>
            <div className="space-y-1.5 pt-3">
              {titles.map((width, row) => (
                // A one-line item row: checkbox, title, then the space of the
                // assignee and ⋯ menu triggers. The ⋯ trigger, the tallest
                // child, sets the row's height.
                <div
                  key={row}
                  className="flex items-start gap-2 rounded-lg border border-neutral-200 bg-white p-2 dark:border-neutral-800 dark:bg-neutral-900"
                >
                  <Bone className="mt-1 size-4 shrink-0" />
                  <span className="block flex-1 py-1">
                    <Bone className={`h-3 ${width}`} />
                  </span>
                  <span className="mt-0.5 size-6 shrink-0" />
                  <span className="h-8 w-6 shrink-0" />
                </div>
              ))}
            </div>
          </ColumnCard>
        ))}
      </BoardRail>
    </BoardMain>
  );
}
