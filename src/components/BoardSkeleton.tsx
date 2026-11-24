import { BoardHeader, BoardMain, BoardRail, ColumnCard } from "./BoardLayout";
import type { BoardView } from "./Kanban";

// The board page while it loads: the real frame from BoardLayout with grey
// placeholders sized to the elements they stand in for, so nothing shifts when
// the page replaces it. Its body is the view that's opening: the Brief, the
// board's lists or Done (Archived, opened from the account menu, gets the
// board's). Shown by the board route's loading.tsx, for the view in the path,
// and by the service-worker-cached /launch page the installed app opens into,
// which goes on to the Brief.

/** A grey placeholder block; size and shape come from `className`. */
function Bone({ className }: { className: string }) {
  return (
    <span
      className={`block rounded bg-neutral-200 motion-safe:animate-pulse dark:bg-neutral-800 ${className}`}
    />
  );
}

/**
 * An item row (ItemRow): checkbox, a 20px title line, then the space of the
 * assignee avatar. With `context` (its width), the 16px list chip under the
 * title, as Done's rows all have.
 */
function RowBone({ width, context }: { width: string; context?: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-neutral-200 bg-white p-2 dark:border-neutral-800 dark:bg-neutral-900">
      <Bone className="mt-0.5 size-4 shrink-0 rounded-full!" />
      <span className="block flex-1 space-y-0.5">
        <span className="block py-1">
          <Bone className={`h-3 ${width}`} />
        </span>
        {context && (
          <span className="flex h-4 items-center">
            <Bone className={`h-4 ${context}`} />
          </span>
        )}
      </span>
      <span className="size-5 shrink-0" />
    </div>
  );
}

/**
 * A day's or due date's section in the Brief and Done: its quiet xs label
 * (16px tall) and count, then its rows.
 */
function SectionBone({
  label,
  titles,
  context,
}: {
  label: string;
  titles: string[];
  context?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <span className="flex h-4 items-center px-1">
        <Bone className={`h-3 ${label}`} />
      </span>
      {titles.map((width, row) => (
        <RowBone key={row} width={width} context={context ? "w-16" : undefined} />
      ))}
    </div>
  );
}

/** Title widths per placeholder item, one list per column. */
const COLUMNS = [
  ["w-3/4", "w-1/2", "w-2/3", "w-4/5", "w-3/5"],
  ["w-2/3", "w-4/5", "w-1/2"],
  ["w-3/5", "w-3/4", "w-2/3", "w-1/2"],
];

/** The board's lists, as Kanban's BoardRail of ProjectColumns. */
function BoardBody() {
  return (
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
                  button (pulled left by that padding), then the name inside
                  its h-8 edit box (pulled left by the box's border and
                  padding). A list's status and Shared badges get a second
                  row only when they apply, so most lists have none. */}
              <span className="-ml-1 p-1">
                <Bone className="size-6 rounded-[4px]" />
              </span>
              <div className="-ml-[7px] flex h-8 min-w-0 flex-1 items-center">
                <span className="px-[7px]">
                  <Bone className="h-4 w-24" />
                </span>
              </div>
            </>
          }
        >
          {/* No summary line: like the status badges, a list's summary
              only shows once written, so most lists have none. */}
          <div className="space-y-1.5 pt-1.5">
            {titles.map((width, row) => (
              <RowBone key={row} width={width} />
            ))}
          </div>
        </ColumnCard>
      ))}
      {/* The frame of AddProjectButton, which always ends the rail. */}
      <span
        aria-hidden="true"
        className="h-full min-h-32 w-72 shrink-0 snap-center sm:snap-start rounded-2xl border-2 border-dashed border-neutral-300 dark:border-neutral-700"
      />
    </BoardRail>
  );
}

/**
 * The Brief (AgendaView, with its greeting): the same columns, and the
 * greeting's date line, rule and hello over the three lines it shows while
 * its text loads (AgendaGreeting), so they carry on from here unchanged.
 * Then one section of rows, as what's due is the user's own.
 */
function BriefBody() {
  return (
    <div className="flex-1 overflow-y-auto" aria-hidden="true">
      <div className="mx-auto w-full max-w-xl px-3 pt-6 pb-[max(0.75rem,env(safe-area-inset-bottom))] min-[900px]:grid min-[900px]:max-w-[68rem] min-[900px]:grid-cols-[minmax(0,24rem)_minmax(0,36rem)] min-[900px]:justify-center min-[900px]:gap-10 min-[900px]:pt-12 min-[1100px]:gap-16">
        <div className="mb-4 min-[900px]:mb-0 min-[900px]:pt-4">
          <div className="px-1 pt-2 pb-1">
            <span className="flex h-4 items-center">
              <Bone className="h-3 w-32" />
            </span>
            <div className="mt-3 h-px w-8 bg-neutral-300 dark:bg-neutral-700" />
            {/* One line of the hello's italic serif: 36px (46px on wide
                screens) at leading-[1.1]. */}
            <span className="mt-3 flex h-[39.6px] items-center min-[900px]:h-[50.6px]">
              <Bone className="h-7 w-64 min-[900px]:h-9 min-[900px]:w-80" />
            </span>
            <div className="mt-3 space-y-2.5 pt-1">
              <div className="h-3 w-full animate-pulse rounded bg-neutral-100 dark:bg-neutral-800/70" />
              <div className="h-3 w-11/12 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800/70" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800/70" />
            </div>
          </div>
        </div>
        <div className="min-w-0 space-y-4">
          <SectionBone label="w-12" titles={["w-3/4", "w-1/2", "w-2/3"]} />
        </div>
      </div>
    </div>
  );
}

/** Done (DoneView): the days' sections, newest first, each row with its list's chip. */
function DoneBody() {
  return (
    <div className="flex-1 overflow-y-auto" aria-hidden="true">
      <div className="mx-auto w-full max-w-xl space-y-4 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <SectionBone label="w-12" titles={["w-2/3", "w-1/2"]} context />
        <SectionBone label="w-20" titles={["w-3/4", "w-3/5", "w-1/2"]} context />
      </div>
    </div>
  );
}

export function BoardSkeleton({ view }: { view: BoardView }) {
  return (
    <BoardMain>
      <BoardHeader nav={<Bone className="h-7 w-[60px] rounded-md sm:w-[147px] touch:h-9 touch:w-[72px] touch:sm:w-[157px]" />}>
        {/* Filter (with no filters on, and only where the board shows them:
            Kanban's filtersApply), Notifications, Account (Kanban), measured.
            Square on phones, like the header's buttons there (BoardHeader). */}
        {(view === "board" || view === "archived") && (
          <Bone className="h-7 w-7 rounded-md sm:w-[90px] touch:h-9 touch:w-9 touch:sm:w-20" />
        )}
        <Bone className="h-7 w-7 rounded-md touch:h-9 touch:w-9 touch:sm:w-[42px]" />
        <span data-account>
          <Bone className="size-7 rounded-full touch:size-9" />
        </span>
      </BoardHeader>
      {view === "brief" || view === "done" || view === "check-ins" ? (
        <>
          <span className="sr-only" role="status">
            {view === "brief" ? "Loading your Brief…" : "Loading what's done…"}
          </span>
          {view === "brief" ? <BriefBody /> : <DoneBody />}
        </>
      ) : (
        <BoardBody />
      )}
    </BoardMain>
  );
}
