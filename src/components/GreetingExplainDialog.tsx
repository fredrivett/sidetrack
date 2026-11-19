"use client";

import Link from "next/link";
import type { GreetingTrace } from "@/core/agendaGreeting";
import type { GreetingLength } from "@/lib/greetingPrefs";
import {
  ResponsiveDialog,
  ResponsiveDialogCloseButton,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from "./ui/responsive-dialog";

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
};

const LENGTH_NAME: Record<GreetingLength, string> = {
  short: "Short",
  medium: "Medium length",
  long: "Long",
};

const pct = (p: number) => `${Math.round(p * 100)}%`;

const dayName = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });

/**
 * "What is this?" for the Agenda greeting: what it is, then how this one
 * was worked out, from the trace kept with it. Item titles only, never what
 * a rejected reply said.
 */
export function GreetingExplainDialog({
  open,
  onOpenChange,
  trace,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trace: GreetingTrace;
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
  ];
  const h3 = "text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400";
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <div className="flex items-center gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <div className="min-w-0">
            <ResponsiveDialogTitle>What is this?</ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-left text-xs">
              How this greeting was worked out
            </ResponsiveDialogDescription>
          </div>
          <ResponsiveDialogCloseButton className="ml-auto shrink-0" />
        </div>
        <div className="max-h-[70vh] space-y-5 overflow-y-auto px-4 py-4 text-sm text-neutral-700 dark:text-neutral-300">
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
                {trace.items.map((i) => (
                  <li key={i.id} className="flex gap-3">
                    <span className="w-10 shrink-0 text-right tabular-nums text-neutral-400">{pct(i.score)}</span>
                    <span className="min-w-0">
                      <span className={i.named ? "font-medium text-neutral-900 dark:text-neutral-100" : ""}>
                        {i.title}
                      </span>
                      <span className="text-neutral-500">
                        {" "}
                        · {i.list}
                        {i.named ? " · named" : i.other ? " · in others" : ""}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <p className="text-xs text-neutral-500">
            Scores are Jev&rsquo;s sense of how worth saying each one is right now. Slipped items,
            what&rsquo;s left this week and winding down are always said when they apply, as far as
            your length leaves room.
          </p>

        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
