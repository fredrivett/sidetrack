"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState } from "react";
import type { GreetingTrace } from "@/core/agendaGreeting";
import type { Item } from "@/core/schema";
import type { GreetingLength } from "@/lib/greetingPrefs";
import {
  ResponsiveDialog,
  ResponsiveDialogBackButton,
  ResponsiveDialogCloseButton,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
  ResponsiveDialogViews,
} from "./ui/responsive-dialog";
import { useItemTrail } from "./use-item-detail-dialog";

/** What each thing it could say is called, in the reader's words. */
const MOMENT_NAME: Record<string, string> = {
  plan: "Today's plan",
  triage: "What slipped",
  week: "What's left this week",
  urgent: "Something time-sensitive",
  heavy: "A busy day ahead",
  tidy: "Something sitting a while",
  "wind-down": "Winding down",
  clear: "A clear day",
  lighten: "A lighter day",
};

const LENGTH_NAME: Record<GreetingLength, string> = {
  short: "Short",
  medium: "Medium length",
  long: "Long",
};

const TITLE = { explain: "What is this?", others: "Also in No date" } as const;

const pct = (p: number) => `${Math.round(p * 100)}%`;

const dayName = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });

/** How an item opened from the list shows: the page's item details, as a view. */
export type RenderItem = (
  item: Item,
  view: {
    back: React.ReactNode;
    open: boolean;
    /** The sub-item just gone back from, to focus. */
    cameFrom: string | null;
    onOpenItem: (item: Item) => void;
    onClose: () => void;
  },
) => React.ReactNode;

/**
 * The greeting's lists of items in a dialog: "What is this?", how it was
 * worked out, or "Also in No date", the rest of the undated items it picked
 * from. An item in the list opens in the same dialog, sliding in with a way
 * back to the list, where it left off, as do the sub-items and parents it
 * goes to from there, each with a way back to the one before. One the page hasn't loaded, such as
 * one finished days ago, is named but can't open; one that goes while it's
 * open takes the dialog back to the list.
 */
export function GreetingDialog({
  open,
  onOpenChange,
  list,
  trace,
  others,
  itemsById,
  refOf,
  renderItem,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  list: "explain" | "others";
  trace: GreetingTrace | undefined;
  others: Array<{ id: string; title: string }>;
  itemsById: Map<string, Item>;
  /** An item's ref, for ⌘. on a hovered row. */
  refOf: (item: Item) => string;
  renderItem: RenderItem;
}) {
  // The item shown, or none for the list.
  const trail = useItemTrail((id) => itemsById.has(id));
  // The list's row last opened, to land on when coming back.
  const [cameFrom, setCameFrom] = useState<string | null>(null);
  // Opened afresh, it starts at the list.
  const [wasOpen, setWasOpen] = useState(open);
  const scroll = useRef(0);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      trail.reset(null);
      setCameFrom(null);
    }
  }
  const item = trail.id ? itemsById.get(trail.id) : undefined;
  const openFromList = (id: string) => {
    setCameFrom(id);
    trail.goTo(id);
  };

  const back = (
    <ResponsiveDialogBackButton
      label={(trail.previousId && itemsById.get(trail.previousId)?.title) || TITLE[list]}
      onClick={trail.back}
    />
  );

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent
        // Choices to press; going back focuses the one it came from.
        initialFocus={null}
      >
        <ResponsiveDialogViews
          view={item ? `item:${item.id}` : list}
          direction={trail.direction}
        >
          {item ? (
            renderItem(item, {
              back,
              open,
              cameFrom: trail.direction === "back" ? trail.left : null,
              onOpenItem: (next) => trail.goTo(next.id),
              onClose: () => onOpenChange(false),
            })
          ) : (
            <>
              <div className="flex shrink-0 items-center gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
                <div className="min-w-0">
                  <ResponsiveDialogTitle>{TITLE[list]}</ResponsiveDialogTitle>
                  <ResponsiveDialogDescription className="text-left text-xs">
                    {list === "explain" ? "How this greeting was worked out" : "Most worth a look first"}
                  </ResponsiveDialogDescription>
                </div>
                <ResponsiveDialogCloseButton className="ml-auto shrink-0" />
              </div>
              <ListBody scroll={scroll} restore={cameFrom !== null}>
                {list === "explain" && trace ? (
                  <Explanation
                    trace={trace}
                    itemsById={itemsById}
                    refOf={refOf}
                    cameFrom={cameFrom}
                    onOpen={openFromList}
                  />
                ) : (
                  <ul className="p-2">
                    {others.map((o) => {
                      const row = "block w-full rounded-md px-2 py-1.5 text-left text-sm";
                      const live = itemsById.get(o.id);
                      return (
                        <li key={o.id}>
                          {live ? (
                            <button
                              type="button"
                              autoFocus={o.id === cameFrom}
                              onClick={() => openFromList(o.id)}
                              data-item-ref={refOf(live)}
                              className={`${row} text-neutral-800 outline-none hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-neutral-300 dark:text-neutral-200 dark:hover:bg-neutral-800`}
                            >
                              <span
                                className={
                                  live.completedAt !== null
                                    ? "text-neutral-400 line-through dark:text-neutral-500"
                                    : ""
                                }
                              >
                                {live.title}
                              </span>
                            </button>
                          ) : (
                            <span className={`${row} text-neutral-500`}>{o.title}</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </ListBody>
            </>
          )}
        </ResponsiveDialogViews>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

/** The list's scrolling body, which picks up where it was left. */
function ListBody({
  scroll,
  restore,
  children,
}: {
  scroll: React.RefObject<number>;
  /** Coming back from an item, rather than opening afresh. */
  restore: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = restore ? scroll.current : 0;
    // Noted as it scrolls: by the time it unmounts, it's been copied away.
    const note = () => (scroll.current = el.scrollTop);
    el.addEventListener("scroll", note, { passive: true });
    return () => el.removeEventListener("scroll", note);
    // Only as it mounts: coming back is a new mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div ref={ref} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      {children}
    </div>
  );
}

/**
 * How this greeting was worked out, from the trace kept with it. Item
 * titles only, never what a rejected reply said.
 */
function Explanation({
  trace,
  itemsById,
  refOf,
  cameFrom,
  onOpen,
}: {
  trace: GreetingTrace;
  itemsById: Map<string, Item>;
  refOf: (item: Item) => string;
  cameFrom: string | null;
  onOpen: (id: string) => void;
}) {
  const l = trace.looked;
  const looked = [
    `${l.dueToday} open today${l.doneToday ? `, ${l.doneToday} done` : ""}`,
    `${l.slipped} slipped`,
    ...(l.thisWeek !== undefined ? [`${l.thisWeek} still open this week`] : []),
    `${l.undated} undated worth a look`,
    `${l.stale} untouched for weeks`,
    l.sinceDay
      ? `${l.finishedSince} finished since ${l.sinceDay === trace.day ? "earlier today" : dayName(l.sinceDay)}`
      : "no earlier visit to look back to",
    ...(l.dayNote ? ["your note for today"] : []),
  ];
  const h3 = "text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400";
  return (
    <div className="space-y-5 px-4 py-4 text-sm text-neutral-700 dark:text-neutral-300">
      <p className="text-pretty">
        A few calm sentences about your day, written once each morning, afternoon and evening
        from your lists. Jev weighs what&rsquo;s worth saying and which items to name; Claude
        puts it into words, and it&rsquo;s checked before you see it. If anything goes wrong,
        a built-in greeting shows instead.
      </p>

      {/* Near the top, so it's easy to find how to change it. */}
      <section className="flex items-center gap-3 rounded-lg bg-neutral-100 px-3 py-2.5 dark:bg-neutral-800/60">
        <p className="min-w-0 flex-1">
          <span className="block font-medium text-neutral-900 dark:text-neutral-100">Your settings</span>
          <span className="block text-xs text-neutral-500">
            {trace.prefs
              ? `${LENGTH_NAME[trace.prefs.length]}${trace.prefs.note ? ", with your note" : ", no note"}`
              : "Length, and a note in your own words"}
          </span>
        </p>
        <Link
          href="/settings/greeting"
          aria-label="Change greeting settings"
          className="shrink-0 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        >
          Change
        </Link>
      </section>

      <section className="space-y-1.5">
        <h3 className={h3}>This one</h3>
        <p>
          For {dayName(trace.day)}, {trace.partOfDay}, worked out at{" "}
          {new Date(trace.at).toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: trace.timeZone,
          })}
          .
        </p>
        <p>
          {trace.why ? (
            <>
              The built-in greeting: <span className="text-neutral-900 dark:text-neutral-100">{trace.why}</span>.
            </>
          ) : (
            <>Written by {trace.model}.</>
          )}
        </p>
      </section>

      <section className="space-y-1.5">
        <h3 className={h3}>What it looked at</h3>
        <ul className="list-disc space-y-0.5 pl-5">
          {looked.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </section>

      {trace.moments && (
        <section className="space-y-1.5">
          <h3 className={h3}>{trace.why ? "What Claude was asked to say" : "What it could say"}</h3>
          <ul className="space-y-2">
            {trace.moments.map((m) => (
              <li key={m.moment} data-said={m.said || undefined} className="flex gap-3">
                <span className="w-10 shrink-0 text-right tabular-nums text-neutral-400">{pct(m.score)}</span>
                <span className="min-w-0">
                  <span className={m.said ? "font-medium text-neutral-900 dark:text-neutral-100" : ""}>
                    {MOMENT_NAME[m.moment] ?? m.moment}
                  </span>
                  <span className="text-neutral-500">
                    {" "}
                    · {m.said ? (trace.why ? "picked" : "said") : "left out"}: {m.why}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {trace.items && trace.items.length > 0 && (
        <section className="space-y-1.5">
          <h3 className={h3}>Items it weighed</h3>
          <ul className="space-y-1.5">
            {trace.items.map((i) => {
              // Finished since, crossed out as on the board.
              const done = itemsById.get(i.id)?.completedAt != null;
              const row = (
                <>
                  <span className="w-10 shrink-0 text-right tabular-nums text-neutral-400">{pct(i.score)}</span>
                  <span className="min-w-0">
                    <span
                      className={`${i.named ? "font-medium" : ""} ${
                        done
                          ? "text-neutral-400 line-through dark:text-neutral-500"
                          : i.named
                            ? "text-neutral-900 dark:text-neutral-100"
                            : ""
                      }`}
                    >
                      {i.title}
                    </span>
                    <span className="text-neutral-500">
                      {" "}
                      · {i.list}
                      {i.named ? " · named" : i.other ? " · in others" : ""}
                    </span>
                  </span>
                </>
              );
              const live = itemsById.get(i.id);
              return (
                <li key={i.id}>
                  {live ? (
                    <button
                      type="button"
                      autoFocus={i.id === cameFrom}
                      onClick={() => onOpen(i.id)}
                      data-item-ref={refOf(live)}
                      className="-mx-2 -my-0.5 flex w-[calc(100%+1rem)] gap-3 rounded-md px-2 py-0.5 text-left outline-none hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-neutral-300 dark:hover:bg-neutral-800 dark:focus-visible:ring-neutral-600"
                    >
                      {row}
                    </button>
                  ) : (
                    <div className="flex gap-3">{row}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <p className="text-xs text-neutral-500">
        Scores are Jev&rsquo;s sense of how worth saying each one is right now. Slipped items,
        what&rsquo;s left this week and winding down are always said when they apply, as far as
        your length leaves room.
      </p>
    </div>
  );
}
