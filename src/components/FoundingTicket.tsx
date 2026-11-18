import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { FOUNDING_BATCHES, foundingBatch, padUserNumber } from "@/lib/founding";

// The founding batch the next account joins, shown above the signup card as
// a ticket: the stub holds the number they'll get, the rest the batch, what
// it comes with, and the seats left. Renders nothing past the last batch.
// No hooks, so the login page renders it on the server.

/**
 * The notches either end of the tear line, cut out of the card (border
 * included) rather than painted over it, so the page shows through them.
 */
const NOTCHES = ["0", "100%"]
  .map((y) => `radial-gradient(circle at 4.75rem ${y}, transparent 8px, black 8.5px)`)
  .join(", ");

/** Up to this many seats, each gets its own mark; past it, one fill bar. */
const MAX_SEAT_MARKS = 24;

export function FoundingTicket({ next }: { next: number }) {
  const found = foundingBatch(next);
  if (!found) return null;
  const { batch, index, first } = found;
  const size = batch.last - first + 1;
  const taken = next - first;
  const left = size - taken;
  const previous = FOUNDING_BATCHES[index - 1];
  const perks = ["Free forever", `${batch.member} #${next}`, ...batch.extraPerks];

  return (
    <section
      aria-label={`${batch.name}, batch ${index + 1}`}
      className="relative grid w-full max-w-sm grid-cols-[4.75rem_minmax(0,1fr)] rounded-2xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
      style={{ mask: NOTCHES, maskComposite: "intersect" }}
    >
      <NotchEdge className="-top-2.5" />
      <NotchEdge className="-bottom-2.5" />
      <div className="flex flex-col items-center justify-center gap-0.5 border-r-[1.5px] border-dashed border-neutral-200 px-1.5 py-4 text-center dark:border-neutral-800">
        <span className="text-[11px] leading-3 text-muted-foreground">Next</span>
        <span className="font-mono text-[22px] leading-8 font-medium tracking-wide tabular-nums">
          {padUserNumber(next)}
        </span>
        <span className="text-[11px] leading-3 text-muted-foreground">
          Batch {index + 1}
        </span>
      </div>
      <div className="min-w-0 space-y-2 p-4 pl-4">
        {previous && (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Check aria-hidden="true" className="size-3" />
            {previous.name} batch is full
          </p>
        )}
        <h2 className="text-sm font-semibold tracking-tight">{batch.name}</h2>
        <p className="text-xs text-pretty text-muted-foreground">{batch.pitch}</p>
        <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
          {perks.map((perk) => (
            <li key={perk} className="flex items-center gap-1">
              <Check aria-hidden="true" className="size-3" />
              {perk}
            </li>
          ))}
        </ul>
        <div className="space-y-1 pt-0.5">
          <SeatMeter size={size} taken={taken} />
          <p className="text-xs text-muted-foreground tabular-nums">
            {left} of {size} seats left
          </p>
        </div>
        <p className="text-[11px] leading-4 text-pretty text-muted-foreground">
          Free forever covers Sidetrack itself. AI features are included during
          early access.
        </p>
      </div>
    </section>
  );
}

/**
 * The border round a notch: a ring just outside the cut-out, whose half
 * beyond the card the mask hides, leaving the arc that joins the card's edge.
 * Offsets are from inside the 1px border: centred on the edge, 9px across.
 */
function NotchEdge({ className }: { className: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "absolute left-[calc(4.75rem-10px)] size-[18px] rounded-full border border-neutral-200 dark:border-neutral-800",
        className,
      )}
    />
  );
}

/** The batch's seats, taken ones filled and the next one half-filled. */
function SeatMeter({ size, taken }: { size: number; taken: number }) {
  if (size > MAX_SEAT_MARKS) {
    return (
      <div
        aria-hidden="true"
        className="h-1.5 overflow-hidden rounded-full ring-1 ring-neutral-200 ring-inset dark:ring-neutral-800"
      >
        <div className="h-full bg-foreground" style={{ width: `${(taken / size) * 100}%` }} />
      </div>
    );
  }
  return (
    <div aria-hidden="true" className="flex h-1.5 gap-0.5">
      {Array.from({ length: size }, (_, seat) => (
        <span
          key={seat}
          className={cn(
            "flex-1 rounded-[2px]",
            seat < taken
              ? "bg-foreground"
              : seat === taken
                ? "bg-foreground/35"
                : "ring-1 ring-neutral-200 ring-inset dark:ring-neutral-800",
          )}
        />
      ))}
    </div>
  );
}
