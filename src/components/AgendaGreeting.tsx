"use client";

import { unstable_rethrow } from "next/navigation";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useEffect, useState } from "react";
import { agendaGreetingAction, setAgendaReadAction } from "@/app/actions";
import type { Greeting } from "@/core/agendaGreeting";
import type { Item } from "@/core/schema";
import { parseGreeting } from "@/lib/greeting";
import {
  ResponsiveDialog,
  ResponsiveDialogCloseButton,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from "./ui/responsive-dialog";
import type { FeedbackAbout } from "./FeedbackDialog";
import { useToday } from "./use-day-start";

const READ_MS = 2000;

/**
 * A word or phrase in the prose that does something when tapped. A span,
 * not a button: a button is a box, so a long title would wrap as a block
 * of its own instead of flowing with the sentence.
 */
function Tap({
  onClick,
  className,
  children,
  ...events
}: {
  onClick: () => void;
  className: string;
  children: React.ReactNode;
} & Pick<React.HTMLAttributes<HTMLSpanElement>, "onPointerEnter" | "onPointerLeave" | "onFocus" | "onBlur">) {
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onClick();
      }}
      className={`cursor-pointer ${className}`}
      {...events}
    >
      {children}
    </span>
  );
}

/** "Good morning, Fred." from the browser's clock, until the server's arrives. */
function helloNow(firstName: string | null): string {
  const hour = new Date().getHours();
  const to = firstName ? `, ${firstName}` : "";
  if (hour >= 4 && hour < 12) return `Good morning${to}.`;
  if (hour >= 12 && hour < 18) return `Good afternoon${to}.`;
  return `Evening${to}.`;
}

/** The greeting as it reads on the page, chips as their titles. */
function plainText(greeting: Greeting): string {
  const body = parseGreeting(greeting.text)
    .map((part) => (part.kind === "item" ? (greeting.titles[part.id] ?? "") : part.text))
    .join("");
  return `${greeting.hello} ${body}`;
}

const dateLine = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });

/**
 * The Agenda's greeting: the date, a large opening line, then a few calm
 * sentences, beside the sections on a wide screen and above them on a
 * narrow one. Its text is fetched once as the Agenda opens (Claude's, or
 * the template's) and stays as first shown while the Agenda is open: the
 * board reloads on every change, and a later one, written after a read
 * stamp, would drop the look-back from under the reader. Until it arrives,
 * faint lines hold its place, so nothing below moves.
 *
 * Items it names are chips that open them, and light up their row while
 * hovered; an action phrase does what it says; "others" lists the rest of
 * the undated items it picked from. Leaving it, by switching view or tab,
 * counts as having read it, so the next greeting looks back from then.
 */
export function AgendaGreeting({
  firstName,
  itemsById,
  onOpenItem,
  onAction,
  onHoverItem,
  onFeedback,
}: {
  firstName: string | null;
  /** Items the page has, so a chip can open its item. */
  itemsById: Map<string, Item>;
  onOpenItem: (item: Item) => void;
  onAction: (action: string) => void;
  onHoverItem: (id: string | null) => void;
  /** A thumbs up or down opens the feedback form; absent hides them. */
  onFeedback?: (about: FeedbackAbout) => void;
}) {
  const today = useToday();
  // Undefined while it loads; null when there's none to show.
  const [greeting, setGreeting] = useState<Greeting | null | undefined>(undefined);
  const [othersOpen, setOthersOpen] = useState(false);

  useEffect(() => {
    let live = true;
    // Background read: it never holds anything up, and a failure just
    // leaves the opening line on its own.
    agendaGreetingAction().then(
      (g) => live && setGreeting(g),
      (error) => {
        unstable_rethrow(error);
        if (live) setGreeting(null);
      },
    );
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    // When it came into view; a glance of under READ_MS isn't a read (and
    // nor is React's dev-only remount).
    let shownAt = document.visibilityState === "visible" ? Date.now() : null;
    const leave = () => {
      if (shownAt !== null && Date.now() - shownAt >= READ_MS) void setAgendaReadAction();
      shownAt = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") shownAt ??= Date.now();
      else leave();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      leave();
    };
  }, []);

  // The server render doesn't know the viewer's day or hour.
  if (!today) return <div className="min-h-24" />;

  const chip =
    "rounded-md bg-neutral-100 px-1 py-px leading-normal box-decoration-clone text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100";
  const link =
    "rounded-sm text-neutral-900 underline decoration-neutral-300 underline-offset-4 outline-none hover:decoration-neutral-500 focus-visible:ring-2 focus-visible:ring-neutral-300 dark:text-neutral-100 dark:decoration-neutral-600 dark:hover:decoration-neutral-400 dark:focus-visible:ring-neutral-600";
  const others = greeting?.others ?? [];

  return (
    <div className="px-1 pt-2 pb-1">
      <p className="text-xs font-medium text-neutral-400 dark:text-neutral-500">{dateLine(today)}</p>
      <h2 className="mt-1 text-[22px] leading-tight font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
        {greeting?.hello ?? helloNow(firstName)}
      </h2>
      {greeting === undefined ? (
        <div aria-hidden="true" className="mt-3 space-y-2.5 pt-1">
          <div className="h-3 w-full animate-pulse rounded bg-neutral-100 dark:bg-neutral-800/70" />
          <div className="h-3 w-11/12 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800/70" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800/70" />
        </div>
      ) : (
        greeting?.text && (
          <>
          <p className="mt-2 animate-in text-[15px] leading-7 text-neutral-600 text-pretty fade-in duration-500 dark:text-neutral-300">
            {parseGreeting(greeting.text).map((part, i) => {
              if (part.kind === "text") return part.text;
              if (part.kind === "action") {
                return (
                  <Tap key={i} onClick={() => onAction(part.action)} className={link}>
                    {part.text}
                  </Tap>
                );
              }
              if (part.kind === "others") {
                return others.length > 0 ? (
                  <Tap key={i} onClick={() => setOthersOpen(true)} className={link}>
                    {part.text}
                  </Tap>
                ) : (
                  part.text
                );
              }
              const item = itemsById.get(part.id);
              const title = item?.title ?? greeting.titles[part.id] ?? "";
              // An item the page hasn't loaded, such as one finished days ago, is named but can't open.
              return item ? (
                <Tap
                  key={i}
                  onClick={() => onOpenItem(item)}
                  onPointerEnter={() => onHoverItem(item.id)}
                  onPointerLeave={() => onHoverItem(null)}
                  // Keyboard focus only: a click leaves focus on the chip after its dialog closes.
                  onFocus={(e) => e.currentTarget.matches(":focus-visible") && onHoverItem(item.id)}
                  onBlur={() => onHoverItem(null)}
                  className={`${chip} outline-none hover:bg-neutral-200 focus-visible:ring-2 focus-visible:ring-neutral-300 dark:hover:bg-neutral-700 dark:focus-visible:ring-neutral-600`}
                >
                  {title}
                </Tap>
              ) : (
                <span key={i} className={chip}>
                  {title}
                </span>
              );
            })}
          </p>
            {onFeedback && (
              <div className="mt-2 flex animate-in gap-1 fade-in duration-500">
                {(["up", "down"] as const).map((rating) => {
                  const Icon = rating === "up" ? ThumbsUp : ThumbsDown;
                  return (
                    <button
                      key={rating}
                      type="button"
                      aria-label={rating === "up" ? "Good greeting" : "Not quite right"}
                      title={rating === "up" ? "Good greeting" : "Not quite right"}
                      onClick={() => onFeedback({ area: "greeting", rating, context: plainText(greeting) })}
                      className="rounded-md p-1.5 text-neutral-300 outline-none hover:bg-neutral-100 hover:text-neutral-600 focus-visible:ring-2 focus-visible:ring-neutral-300 dark:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
                    >
                      <Icon className="size-3.5" />
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )
      )}

      <ResponsiveDialog open={othersOpen} onOpenChange={setOthersOpen}>
        <ResponsiveDialogContent>
          <div className="flex items-center gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
            <div className="min-w-0">
              <ResponsiveDialogTitle>Also in No date</ResponsiveDialogTitle>
              <ResponsiveDialogDescription className="text-left text-xs">
                Most worth a look first
              </ResponsiveDialogDescription>
            </div>
            <ResponsiveDialogCloseButton className="ml-auto shrink-0" />
          </div>
          <ul className="max-h-[60vh] overflow-y-auto p-2">
            {others.map((o) => {
              const item = itemsById.get(o.id);
              const row = "block w-full rounded-md px-2 py-1.5 text-left text-sm";
              // One the page hasn't loaded is named, but can't open.
              if (!item) {
                return (
                  <li key={o.id} className={`${row} text-neutral-500`}>
                    {o.title}
                  </li>
                );
              }
              return (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setOthersOpen(false);
                      onOpenItem(item);
                    }}
                    className={`${row} text-neutral-800 outline-none hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-neutral-300 dark:text-neutral-200 dark:hover:bg-neutral-800`}
                  >
                    {item.title}
                  </button>
                </li>
              );
            })}
          </ul>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  );
}
