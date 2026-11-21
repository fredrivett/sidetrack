"use client";

import { Check, ChevronDown, NotebookPen, Plus, RefreshCw, Settings, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { setAgendaReadAction, setDayNoteAction } from "@/app/actions";
import type { Greeting } from "@/core/agendaGreeting";
import type { Item } from "@/core/schema";
import { DAY_TAGS, type DayTag, joinDayNote, splitDayNote, toggleDayTag } from "@/lib/dayTags";
import { parseGreeting } from "@/lib/greeting";
import { NOTE_MAX } from "@/lib/greetingPrefs";
import { aiRead } from "./ai-read";
import type { FeedbackAbout } from "./FeedbackDialog";
import { GreetingDialog, type RenderItem } from "./GreetingDialog";
import { runAction } from "./run-action";
import { Struck } from "./Struck";
import { useToday } from "./use-day-start";
import { useDraft } from "./use-draft";
import { useStoredState } from "./use-stored-state";

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
  "data-item-ref"?: string;
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
export function helloNow(firstName: string | null): string {
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
  refOf,
  greeting: fixed,
}: {
  firstName: string | null;
  /** Items the page has, so a chip can open its item. */
  itemsById: Map<string, Item>;
  /** An item's ref, such as "SID-42", for ⌘. on a hovered chip. */
  refOf: (item: Item) => string;
  onOpenItem: (item: Item) => void;
  onAction: (action: string) => void;
  onHoverItem: (id: string | null) => void;
  /** A thumbs up or down opens the feedback form; absent hides them. */
  onFeedback?: (about: FeedbackAbout) => void;
  /** An item opened from one of its dialogs, shown in that dialog. */
  renderItem: RenderItem;
  /** The "+" by the date: New item, due today. */
  onAddForToday?: () => void;
  /**
   * A greeting to show instead of asking the server for one, as the landing
   * page's preview does: never asked for again, marked read or out of date.
   */
  greeting?: Greeting;
}) {
  const today = useToday();
  // Undefined while it loads; null when there's none to show.
  const [loaded, setGreeting] = useState<Greeting | null | undefined>(undefined);
  const greeting = fixed ?? loaded;
  const isFixed = fixed !== undefined;
  // The viewer's note for today: as each greeting brings it, then as they save it.
  const [note, setNote] = useState("");
  const dayNote = splitDayNote(note);
  // The note as last set, for saves in quick succession (taps on its tags).
  const noteNow = useRef("");
  // What's being typed into it, and the tags Jev thinks fit that.
  const [typed, setTyped] = useState<string | null>(null);
  const [suggested, setSuggested] = useState<DayTag[]>([]);
  // The greeting is rewritten with the note once its changes stop for a moment.
  const rewriteSoon = useRef<ReturnType<typeof setTimeout>>(undefined);
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

  const notesSaving = useRef(0);
  // Held while a save is in flight: the server cleans the note up, and its
  // saved text is what the box's draft is kept against.
  const [savingNote, setSavingNote] = useState(false);
  /**
   * Shows `next` as today's note at once and saves it, putting the last one
   * back if it fails; once saves stop for a moment, the greeting is
   * rewritten with it, so a few taps in a row ask Claude once.
   */
  const saveNote = async (next: string) => {
    const before = noteNow.current;
    const show = (n: string) => {
      noteNow.current = n;
      setNote(n);
    };
    show(next);
    clearTimeout(rewriteSoon.current);
    notesSaving.current += 1;
    setSavingNote(true);
    const saved = await runAction(
      // As the server kept it, unless it's been changed again since.
      setDayNoteAction(next).then((kept) => noteNow.current === next && show(kept ?? "")),
      "save your note for today",
    );
    notesSaving.current -= 1;
    setSavingNote(notesSaving.current > 0);
    // Even after a failure: an earlier save in the run may have landed. One
    // that didn't change the note is answered without asking Claude.
    if (notesSaving.current === 0) rewriteSoon.current = setTimeout(() => askAgain(true), 1500);
    if (!saved && noteNow.current === next) show(before);
    return saved;
  };
  useEffect(() => () => clearTimeout(rewriteSoon.current), []);

  // The check-in folds away under its heading, as each person leaves it.
  const [noteOpen, setNoteOpen] = useStoredState("greeting:note-open", true);
  const noteId = useId();
  // What's typed, kept through a reload until it's saved; per day, so
  // yesterday's unsaved words don't turn up today.
  const noteDraft = useDraft(today ? `day:${today}:note` : null, dayNote.rest);
  // Chips picked but not saved yet, kept with the typed text as the draft;
  // null while they're as saved.
  const [pickedTags, setPickedTags] = useStoredState<DayTag[] | null>(
    today ? `draft:day:${today}:note-tags` : "draft:day:note-tags",
    null,
  );
  const tagsShown = pickedTags ?? dayNote.tags;
  const sameTags = (a: readonly DayTag[], b: readonly DayTag[]) =>
    a.length === b.length && a.every((t) => b.includes(t));
  // Something to save: typing or chips that differ from the saved note.
  const unsaved = noteDraft.value.trim() !== dayNote.rest || !sameTags(tagsShown, dayNote.tags);
  /** Saves the chips and the text together, as one submit. */
  const submitNote = () => {
    if (notesSaving.current > 0 || !unsaved) return;
    void saveNote(joinDayNote(tagsShown, noteDraft.value)).then((saved) => {
      // A failed save keeps the draft (see "Drafts" in AGENTS.md).
      if (!saved) return;
      noteDraft.clear();
      setPickedTags(null);
    });
  };
  /** Drops what's not saved, text and chips. */
  const cancelNote = () => {
    noteDraft.clear();
    setPickedTags(null);
  };
  /** Marks `tag` on or off; it's saved with the text by Save. */
  const toggleTag = (tag: DayTag) => {
    if (notesSaving.current > 0) return;
    const next = toggleDayTag(joinDayNote(tagsShown, noteDraft.value), tag);
    if (next === null) return;
    const tags = splitDayNote(next).tags;
    setPickedTags(sameTags(tags, dayNote.tags) ? null : tags);
  };

  // Tags that fit what's being typed, asked for once typing pauses. Kept
  // once the edit's over, to tap; a failed ask suggests nothing new.
  useEffect(() => {
    if (typed === null) return;
    const stop = new AbortController();
    const t = setTimeout(() => {
      if (!typed.trim()) setSuggested([]);
      else aiRead("dayTags", { text: typed }, stop.signal).then(setSuggested, () => {});
    }, 400);
    return () => {
      clearTimeout(t);
      stop.abort();
    };
  }, [typed]);

  useEffect(() => {
    if (isFixed) return;
    let live = true;
    // Background read: it never holds anything up, and a failure just
    // leaves the opening line on its own. Asking again keeps the greeting
    // shown until the new one arrives.
    aiRead("greeting", { now: askedNow.current }).then(
      (g) => {
        if (!live) return;
        setGreeting(g);
        // Not over a change of the viewer's still being saved.
        if (notesSaving.current === 0) {
          noteNow.current = g?.note ?? "";
          setNote(noteNow.current);
        }
        setAsking(false);
        const at = g?.retryInMs === undefined ? null : Date.now() + g.retryInMs;
        setRetryAt(at);
        setClock(Date.now());
        // Up to date unless the server is holding an out-of-date one.
        if (at === null) setChanged(false);
      },
      () => {
        if (!live) return;
        setAsking(false);
        if (asks === 0) setGreeting(null);
      },
    );
    return () => {
      live = false;
    };
  }, [asks, isFixed]);

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
    if (isFixed || shownWith.current === null) return;
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
  }, [standing, isFixed]);

  useEffect(() => {
    if (isFixed) return;
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
  }, [isFixed]);

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
                  data-item-ref={refOf(item)}
                  onPointerEnter={() => onHoverItem(item.id)}
                  onPointerLeave={() => onHoverItem(null)}
                  // Keyboard focus only: a click leaves focus on the chip after its dialog closes.
                  onFocus={(e) => e.currentTarget.matches(":focus-visible") && onHoverItem(item.id)}
                  onBlur={() => onHoverItem(null)}
                  className={`${card} outline-none hover:border-neutral-400 hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-neutral-300 dark:hover:border-neutral-500 dark:hover:bg-neutral-800 dark:focus-visible:ring-neutral-600`}
                >
                  {item.completedAt !== null ? (
                    <Struck className="[--strike-gap:var(--color-white)] dark:[--strike-gap:var(--color-neutral-900)]">
                      {title}
                    </Struck>
                  ) : (
                    title
                  )}
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
                {/* Signed out, on the preview, settings would only ask to sign in. */}
                {!isFixed && <Link
                  href="/settings/greeting"
                  aria-label="Greeting settings"
                  title="Greeting settings"
                  className="rounded-md p-1.5 text-neutral-300 outline-none hover:bg-neutral-100 hover:text-neutral-600 focus-visible:ring-2 focus-visible:ring-neutral-300 dark:focus-visible:ring-neutral-600 dark:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
                >
                  <Settings className="size-3.5" />
                </Link>}
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

      {/* What they wrote about today, for the greeting to be written with:
          tags they tap and words they type, saved as they go, then the
          greeting asks to be rewritten with it.
          Not offered when AI is off, as nothing would read it, nor on the
          landing page's preview, where it can't be saved. */}
      {greeting && !greeting.aiOff && !isFixed && (
        <div className="mt-3 animate-in fade-in duration-500">
          <button
            type="button"
            onClick={() => setNoteOpen((open) => !open)}
            aria-expanded={noteOpen}
            aria-controls={noteId}
            className="flex w-full min-w-0 items-center gap-2 rounded-md py-0.5 text-left text-sm text-neutral-600 outline-none hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-neutral-300 dark:text-neutral-400 dark:hover:text-neutral-100 dark:focus-visible:ring-neutral-600"
          >
            <NotebookPen aria-hidden className="size-3.5 shrink-0 text-neutral-400 dark:text-neutral-500" />
            <span className="shrink-0">How&apos;s today looking?</span>
            {/* Folded, what they said shows beside it, so it's still in view. */}
            {!noteOpen && note && (
              <span className="min-w-0 truncate italic text-neutral-400 dark:text-neutral-500">{note}</span>
            )}
            {!noteOpen && unsaved && (
              <span className="shrink-0 text-xs text-amber-700 dark:text-amber-400">Not saved</span>
            )}
            <ChevronDown
              aria-hidden
              className={`ml-auto size-3.5 shrink-0 transition-transform duration-300 ease-out motion-reduce:transition-none ${noteOpen ? "rotate-180" : ""}`}
            />
          </button>
          {/* Rows 0fr to 1fr animates to the content's height; folded, it's inert. */}
          <div
            id={noteId}
            inert={!noteOpen}
            className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${
              noteOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
            }`}
          >
            {/* -mx-1 px-1 and pb-1 leave room for the focus rings. */}
            <div className="-mx-1 min-h-0 overflow-hidden">
              <div className="px-1 pt-2 pb-1 pl-6.5">
                <Textarea
                  draft={noteDraft}
                  aria-label="How's today looking?"
                  placeholder={tagsShown.length ? "Anything else?" : "A few words about today, if you like"}
                  rows={2}
                  // What's left of the note once its tags are in.
                  maxLength={NOTE_MAX - (tagsShown.length ? joinDayNote(tagsShown, "x").length - 1 : 0)}
                  readOnly={savingNote}
                  aria-busy={savingNote || undefined}
                  onChange={(e) => {
                    // Kept as one line, as the server keeps it, so a pasted break isn't lost on save.
                    const text = e.target.value.replace(/\s*\n\s*/g, " ");
                    noteDraft.set(text);
                    setTyped(text);
                  }}
                  onKeyDown={(e) => {
                    // Enter saves, as Save does; the note is one line, so it wraps rather than breaks.
                    if (e.key === "Enter") {
                      e.preventDefault();
                      submitNote();
                    }
                    if (e.key === "Escape") cancelNote();
                  }}
                  className={`min-h-14 resize-none text-sm transition-opacity ${savingNote ? "opacity-60" : ""}`}
                />
                {/* Quick words for the note, toggled as they're tapped; the ones
                    Jev thinks fit what was typed are marked as suggestions. */}
                <div role="group" aria-label="How today feels" className="mt-2 flex flex-wrap gap-1.5">
                  {(Object.keys(DAY_TAGS) as DayTag[]).map((tag) => {
                    const on = tagsShown.includes(tag);
                    const hint = !on && suggested.includes(tag);
                    // Too long a note to add it to without cutting off what was typed.
                    const full = toggleDayTag(joinDayNote(tagsShown, noteDraft.value), tag) === null;
                    return (
                      <button
                        key={tag}
                        type="button"
                        aria-pressed={on}
                        aria-disabled={full || savingNote || undefined}
                        title={full ? "Your note is too long to add this" : hint ? "Suggested from your note" : undefined}
                        onClick={() => toggleTag(tag)}
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-neutral-300 aria-disabled:pointer-events-none aria-disabled:opacity-40 touch:py-1 dark:focus-visible:ring-neutral-600 ${
                          on
                            ? "border-neutral-800 bg-neutral-800 text-white hover:bg-neutral-700 dark:border-neutral-200 dark:bg-neutral-200 dark:text-neutral-900 dark:hover:bg-neutral-300"
                            : hint
                              ? "border-neutral-400 border-dashed bg-white text-neutral-800 hover:border-neutral-500 dark:border-neutral-500 dark:bg-neutral-900 dark:text-neutral-100"
                              : "border-neutral-200 text-neutral-500 hover:border-neutral-300 hover:text-neutral-800 dark:border-neutral-800 dark:text-neutral-400 dark:hover:border-neutral-700 dark:hover:text-neutral-100"
                        }`}
                      >
                        {hint && <Sparkles aria-hidden className="size-3" />}
                        {tag}
                        {hint && <span className="sr-only"> (suggested)</span>}
                      </button>
                    );
                  })}
                </div>
                {/* Slides down only when there's something to save or drop:
                    nothing is saved until Save is pressed. Rows 0fr to 1fr
                    animates to its height; hidden, it's inert. */}
                <div
                  inert={!(unsaved || savingNote)}
                  className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${
                    unsaved || savingNote ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                  }`}
                >
                  {/* -mx-1 px-1 and pb-1 leave room for the focus rings. */}
                  <div className="-mx-1 min-h-0 overflow-hidden">
                    <div className="flex items-center gap-2 px-1 pt-3 pb-1">
                      <Button
                        size="sm"
                        onClick={submitNote}
                        aria-disabled={savingNote || undefined}
                        className="aria-disabled:pointer-events-none aria-disabled:opacity-60"
                      >
                        <Check aria-hidden />
                        {savingNote ? "Saving…" : "Save"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={cancelNote}
                        aria-disabled={savingNote || undefined}
                        className="aria-disabled:pointer-events-none aria-disabled:opacity-60"
                      >
                        Discard
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <GreetingDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        list={dialogList}
        trace={greeting?.trace}
        others={others}
        itemsById={itemsById}
        refOf={refOf}
        renderItem={renderItem}
      />
    </div>
  );
}
