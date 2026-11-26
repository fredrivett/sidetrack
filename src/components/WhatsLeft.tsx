"use client";

import { CalendarArrowUp, Check } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import type { AiReadResult } from "@/app/api/ai/reads";
import { addDays } from "@/lib/time";
import { Button } from "@/components/ui/button";
import { aiRead } from "./ai-read";
import { useItemSaves } from "./item-saves";
import { runAction } from "./run-action";

type Found = NonNullable<AiReadResult<"whatsLeft">>;

// Not newDays.ts's dayName: that module holds the model call, kept off the client.
const weekdayOf = (day: string, style: "long" | "short") =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: style, timeZone: "UTC" });

/**
 * What's left of the day as it's closed, one item at a time: each with the
 * day Claude (or the rules) suggests and why, to move it there, pick
 * another day of the week ahead, or leave it. Each move is the item's own
 * due-date change, saved there and then and held until it lands, so
 * closing the day never waits on them. Asked for once `ask` is first true.
 */
export function WhatsLeft({ today, ask }: { today: string; ask: boolean }) {
  const saves = useItemSaves();
  // Undefined until asked and answered; null when there's nothing to show.
  const [found, setFound] = useState<Found | null | undefined>(undefined);
  const [asked, setAsked] = useState(false);
  if (ask && !asked) setAsked(true);
  const [step, setStep] = useState(0);
  const [moved, setMoved] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const [saving, start] = useTransition();
  // Where focus goes when the buttons it was on go: a picked day, or the last step.
  const group = useRef<HTMLDivElement>(null);

  // A suggestion: one that can't be had leaves the step out.
  useEffect(() => {
    if (!asked) return;
    const stop = new AbortController();
    aiRead("whatsLeft", {}, stop.signal).then(setFound, () => setFound(null));
    return () => stop.abort();
  }, [asked]);

  if (!asked || found === null || found?.items.length === 0) return null;
  const nameOf = (day: string) => (day === addDays(today, 1) ? "tomorrow" : weekdayOf(day, "long"));

  const heading = (aside: string) => (
    <div className="mt-3 flex items-baseline gap-2 border-t border-stone-200 pt-2.5 text-sm dark:border-stone-700">
      <span className="text-neutral-800 dark:text-neutral-200">What&apos;s left</span>
      <span aria-live="polite" className="text-xs text-neutral-500 tabular-nums dark:text-neutral-400">
        {aside}
      </span>
    </div>
  );

  if (found === undefined) {
    return (
      <div role="group" aria-label="What's left" aria-busy>
        {heading("Finding new days…")}
        <div className="mt-2 h-24 animate-pulse rounded-lg bg-white motion-reduce:animate-none dark:bg-neutral-950" />
      </div>
    );
  }

  const { items, ahead } = found;
  if (step >= items.length) {
    const by = new Map<string, number>();
    for (const day of moved) by.set(day, (by.get(day) ?? 0) + 1);
    const parts = ahead.filter((d) => by.has(d.day)).map((d) => `${by.get(d.day)} to ${nameOf(d.day)}`);
    return (
      <div ref={group} tabIndex={-1} role="group" aria-label="What's left" className="outline-none">
        {heading(parts.length ? `Moved ${parts.join(", ")}` : "Nothing moved")}
      </div>
    );
  }

  const item = items[step];
  const next = (day: string | null) => {
    if (saving) return;
    const refocus = picking || step === items.length - 1;
    const advance = () => {
      setPicking(false);
      setStep((s) => s + 1);
      if (refocus) group.current?.focus();
    };
    if (day === null) {
      advance();
      return;
    }
    start(async () => {
      const done = await runAction(
        saves.updateItem(item.id, { dueDate: day, dueFrom: null }),
        `move “${item.title}” to ${nameOf(day)}`,
      );
      if (!done) return;
      setMoved((m) => [...m, day]);
      advance();
    });
  };
  // How full each day is, counting what this has moved there already.
  const load = (day: string) => (ahead.find((d) => d.day === day)?.open ?? 0) + moved.filter((d) => d === day).length;

  return (
    <div ref={group} tabIndex={-1} role="group" aria-label="What's left" className="outline-none">
      {heading(`${step + 1} of ${items.length}`)}
      <div
        aria-busy={saving || undefined}
        className={`mt-2 rounded-lg bg-white p-2.5 transition-opacity dark:bg-neutral-950 ${saving ? "opacity-60" : ""}`}
      >
        <p className="truncate text-sm text-neutral-900 dark:text-neutral-100">{item.title}</p>
        <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
          {item.context} · {item.why}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Button
            size="xs"
            variant="outline"
            onClick={() => next(item.day)}
            aria-disabled={saving || undefined}
            className="aria-disabled:pointer-events-none"
          >
            <Check aria-hidden />
            Move to {nameOf(item.day)}
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => !saving && setPicking(!picking)}
            aria-expanded={picking}
            aria-disabled={saving || undefined}
            className="aria-disabled:pointer-events-none"
          >
            <CalendarArrowUp aria-hidden />
            Another day
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => next(null)}
            aria-disabled={saving || undefined}
            className="text-neutral-500 aria-disabled:pointer-events-none dark:text-neutral-400"
          >
            Leave it
          </Button>
        </div>
        {picking && (
          <div role="group" aria-label="Move it to" className="mt-2 flex flex-wrap gap-1.5">
            {ahead.map(({ day }) => (
              <Button
                key={day}
                size="xs"
                variant="outline"
                onClick={() => next(day)}
                aria-label={`${weekdayOf(day, "long")}, ${load(day)} already`}
                aria-disabled={saving || undefined}
                className="aria-disabled:pointer-events-none"
              >
                {weekdayOf(day, "short")}
                <span className="text-neutral-400 tabular-nums dark:text-neutral-500">{load(day)}</span>
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
