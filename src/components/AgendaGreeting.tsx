"use client";

import { unstable_rethrow } from "next/navigation";
import { Plus, RefreshCw, Settings, ThumbsDown, ThumbsUp } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { agendaGreetingAction, setAgendaReadAction } from "@/app/actions";
import type { Greeting } from "@/core/agendaGreeting";
import type { Item } from "@/core/schema";
import { parseGreeting } from "@/lib/greeting";
import type { FeedbackAbout } from "./FeedbackDialog";
import { GreetingDialog, type RenderItem } from "./GreetingDialog";
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

/** "45s", or "4m 05s" once the back-off reaches minutes. */
const countdown = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`);

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
 * narrow one. Its text is fetched as the Agenda opens (Claude's, or the
 * template's) and again only when an item it names changes, not on every
 * board reload: one written after a read stamp drops the look-back. Until
 * it arrives, faint lines hold its place, so nothing below moves.
 *
 * Items it names are chips that open them, and light up their row while
 * hovered; an action phrase does what it says; "others" lists the rest of
 * the undated items it picked from, and "What is this?" how it was worked
 * out, each in a dialog whose items open in place (GreetingDialog). Leaving
 * it, by switching view or tab, counts as having read it, so the next
 * greeting looks back from then.
 */
export function AgendaGreeting({
  firstName,
  itemsById,
  onOpenItem,
  onAction,
  onHoverItem,
  onFeedback,
  renderItem,
  onAddForToday,
}: {
  firstName: string | null;
  /** Items the page has, so a chip can open its item. */
  itemsById: Map<string, Item>;
  onOpenItem: (item: Item) => void;
  onAction: (action: string) => void;
  onHoverItem: (id: string | null) => void;
  /** A thumbs up or down opens the feedback form; absent hides them. */
  onFeedback?: (about: FeedbackAbout) => void;
  /** An item opened from one of its dialogs, shown in that dialog. */
  renderItem: RenderItem;
  /** The "+" by the date: New item, due today. */
  onAddForToday?: () => void;
}) {
  const today = useToday();
  // Undefined while it loads; null when there's none to show.
  const [greeting, setGreeting] = useState<Greeting | null | undefined>(undefined);
  // Which of its dialogs is up, kept as it closes so it animates out as it was.
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogList, setDialogList] = useState<"explain" | "others">("explain");
  const openDialog = (list: "explain" | "others") => {
    setDialogList(list);
    setDialogOpen(true);
  };

  // Bumped to ask again when an item it names changes while it's open.
  const [asks, setAsks] = useState(0);
  // Out of date: an item it names changed since it was written. Shown faded,
  // with when it's rewritten and a button to rewrite it now.
  const [changed, setChanged] = useState(false);
  // An ask is under way, and whether the reader asked for it with "Rewrite now".
  const [asking, setAsking] = useState(false);
  const askedNow = useRef(false);
  // When the server says it may rewrite it (from retryInMs), and a clock for the countdown.
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const askAgain = (now = false) => {
    askedNow.current = now;
    setAsking(true);
    setAsks((n) => n + 1);
  };

  useEffect(() => {
    let live = true;
    // Background read: it never holds anything up, and a failure just
    // leaves the opening line on its own. Asking again keeps the greeting
    // shown until the new one arrives.
    agendaGreetingAction(askedNow.current).then(
      (g) => {
        if (!live) return;
        setGreeting(g);
        setAsking(false);
        const at = g?.retryInMs === undefined ? null : Date.now() + g.retryInMs;
        setRetryAt(at);
        setClock(Date.now());
        // Up to date unless the server is holding an out-of-date one.
        if (at === null) setChanged(false);
      },
      (error) => {
        unstable_rethrow(error);
        if (!live) return;
        setAsking(false);
        if (asks === 0) setGreeting(null);
      },
    );
    return () => {
      live = false;
    };
  }, [asks]);

  // How the items it names stand now, on the board, as the server stamps
  // them: a change (ticked off, renamed, moved, reassigned, gone) asks for
  // it again, which the server rewrites when it may.
  const named = greeting?.text ? Object.keys(greeting.titles) : [];
  const standing = JSON.stringify(
    named.map((id) => {
      const i = itemsById.get(id);
      return i
        ? [i.title, i.dueDate, i.dueFrom, i.completedAt !== null, [...i.assigneeIds].sort()]
        : null;
    }),
  );
  const shownWith = useRef<string | null>(null);
  // Declared first, so it notes how things stood before the check below runs.
  useEffect(() => {
    shownWith.current = greeting?.text ? standing : null;
    // Only when a greeting arrives, not as things change under it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [greeting]);
  // Out of date but too soon to rewrite: ask again once it may.
  const retryInMs = greeting?.retryInMs;
  useEffect(() => {
    if (retryInMs === undefined) return;
    // With the flag the last ask had, so a Rewrite now isn't put back to the longer wait.
    // At least every 30s: another tab may have rewritten it meanwhile, and a
    // held ask costs nothing. A hidden tab waits until it's seen again.
    const ask = () => {
      if (document.visibilityState === "hidden") return;
      document.removeEventListener("visibilitychange", ask);
      askAgain(askedNow.current);
    };
    const t = setTimeout(() => {
      if (document.visibilityState === "hidden") document.addEventListener("visibilitychange", ask);
      else ask();
    }, Math.min(retryInMs + 1000, 30_000));
    return () => {
      clearTimeout(t);
      document.removeEventListener("visibilitychange", ask);
    };
  }, [greeting, retryInMs]);
  // A second's tick for "Rewriting in Xs", shown only on a written one.
  const written = Boolean(greeting?.written);
  useEffect(() => {
    if (retryAt === null || !written) return;
    const t = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(t);
  }, [retryAt, written]);
  useEffect(() => {
    if (shownWith.current === null) return;
    if (standing === shownWith.current) {
      // Changed back (an undo) before it asked: up to date again.
      const back = setTimeout(() => setChanged(false), 0);
      return () => clearTimeout(back);
    }
    // Faded at once; then, after a moment's grace so ticking off a few in a
    // row asks once, asked for again.
    const fade = setTimeout(() => setChanged(true), 0);
    const t = setTimeout(() => askAgain(), 1500);
    return () => {
      clearTimeout(fade);
      clearTimeout(t);
    };
  }, [standing]);

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

  // Only a written one goes out of date: the built-in one is always current,
  // even while the server says when to ask again.
  const stale = Boolean(greeting?.written && greeting.text) && (changed || retryAt !== null);

  // The server render doesn't know the viewer's day or hour.
  if (!today) return <div className="min-h-24" />;

  const chip =
    "relative -top-px rounded-md border px-1.5 py-px font-sans text-[0.8em] font-medium leading-normal box-decoration-clone";
  // One that opens its item: a small white card, like the item rows beside it.
  const card = `${chip} border-neutral-300 bg-white text-neutral-900 shadow-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100`;
  const link =
    "rounded-sm text-neutral-900 underline decoration-neutral-500 decoration-[1.5px] underline-offset-4 outline-none hover:decoration-neutral-900 focus-visible:ring-2 focus-visible:ring-neutral-300 dark:text-neutral-100 dark:decoration-neutral-500 dark:hover:decoration-neutral-300 dark:focus-visible:ring-neutral-600";
  const others = greeting?.others ?? [];

  return (
    <div className="px-1 pt-2 pb-1">
      <div className="flex items-center gap-1">
        <p className="text-xs font-medium text-neutral-400 dark:text-neutral-500">{dateLine(today)}</p>
        {onAddForToday && (
          <Tooltip>
            <TooltipTrigger
              render={
                // Quiet, as the date is, but dark enough to read as a control.
                <button
                  type="button"
                  aria-label="Add for today"
                  onClick={onAddForToday}
                  className="-my-1 inline-flex size-5 items-center justify-center rounded-md text-neutral-500 outline-none transition-colors hover:bg-neutral-200/60 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-neutral-300 touch:-my-2 touch:size-8 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100 dark:focus-visible:ring-neutral-600"
                >
                  <Plus aria-hidden className="size-3.5 touch:size-4" />
                </button>
              }
            />
            <TooltipContent side="bottom">Add for today</TooltipContent>
          </Tooltip>
        )}
      </div>
      <div aria-hidden="true" className="mt-3 h-px w-8 bg-neutral-300 dark:bg-neutral-700" />
      <h2 className="mt-3 font-display text-[36px] leading-[1.1] font-normal tracking-[-0.01em] text-neutral-900 italic min-[900px]:text-[46px] dark:text-neutral-100">
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
          <p
            aria-busy={(stale && asking) || undefined}
            className={`transition-opacity ${stale ? "opacity-45" : ""} mt-2 animate-in font-serif text-[18px] leading-[1.7] font-light text-neutral-700 text-pretty fade-in duration-500 min-[900px]:mt-3 min-[900px]:text-[21px] dark:text-neutral-300`}
          >
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
                  <Tap key={i} onClick={() => openDialog("others")} className={link}>
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
                  className={`${card} outline-none hover:border-neutral-400 hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-neutral-300 dark:hover:border-neutral-500 dark:hover:bg-neutral-800 dark:focus-visible:ring-neutral-600`}
                >
                  {title}
                </Tap>
              ) : (
                // One the page hasn't loaded opens nothing, so it's muted.
                <span
                  key={i}
                  className={`${chip} border-dashed border-neutral-300 text-neutral-600 dark:border-neutral-700 dark:text-neutral-400`}
                >
                  {title}
                </span>
              );
            })}
          </p>
            {stale && (
              <p className="mt-2 flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                <span>
                  {asking ? (
                    "Rewriting…"
                  ) : (
                    <>
                      Out of date
                      {/* Seconds left out of the announcement: it'd read every tick. */}
                      {retryAt !== null && retryAt > clock && (
                        <span aria-hidden> · rewriting in {countdown(Math.ceil((retryAt - clock) / 1000))}</span>
                      )}
                    </>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => !asking && askAgain(true)}
                  aria-disabled={asking || undefined}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-neutral-700 outline-none hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-neutral-300 aria-disabled:pointer-events-none aria-disabled:opacity-50 dark:text-neutral-200 dark:hover:bg-neutral-800 dark:focus-visible:ring-neutral-600"
                >
                  <RefreshCw aria-hidden className={`size-3 ${asking ? "animate-spin motion-reduce:animate-none" : ""}`} />
                  Rewrite now
                </button>
              </p>
            )}
            {/* Always there, so screen readers announce it when it fills. */}
            <span className="sr-only" aria-live="polite">
              {stale ? (asking ? "Rewriting the brief" : "The brief is out of date") : ""}
            </span>
            <div className="mt-2 flex animate-in items-center gap-1 fade-in duration-500">
                {/* On Claude's greetings only, so a thumbs down is about Claude. */}
                {onFeedback && greeting.written && (["up", "down"] as const).map((rating) => {
                  const Icon = rating === "up" ? ThumbsUp : ThumbsDown;
                  return (
                    <button
                      key={rating}
                      type="button"
                      aria-label={rating === "up" ? "Good greeting" : "Not quite right"}
                      title={rating === "up" ? "Good greeting" : "Not quite right"}
                      onClick={() => onFeedback({ area: "greeting", rating, context: plainText(greeting) })}
                      className="rounded-md p-1.5 text-neutral-300 outline-none hover:bg-neutral-100 hover:text-neutral-600 focus-visible:ring-2 focus-visible:ring-neutral-300 dark:focus-visible:ring-neutral-600 dark:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
                    >
                      <Icon className="size-3.5" />
                    </button>
                  );
                })}
                <Link
                  href="/settings/greeting"
                  aria-label="Greeting settings"
                  title="Greeting settings"
                  className="rounded-md p-1.5 text-neutral-300 outline-none hover:bg-neutral-100 hover:text-neutral-600 focus-visible:ring-2 focus-visible:ring-neutral-300 dark:focus-visible:ring-neutral-600 dark:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
                >
                  <Settings className="size-3.5" />
                </Link>
                {greeting.trace && (
                  <button
                    type="button"
                    onClick={() => openDialog("explain")}
                    className="rounded-md px-1.5 py-1 text-xs text-neutral-400 outline-none hover:bg-neutral-100 hover:text-neutral-600 focus-visible:ring-2 focus-visible:ring-neutral-300 dark:focus-visible:ring-neutral-600 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
                  >
                    What is this?
                  </button>
                )}
              </div>
          </>
        )
      )}

      <GreetingDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        list={dialogList}
        trace={greeting?.trace}
        others={others}
        itemsById={itemsById}
        renderItem={renderItem}
      />
    </div>
  );
}
