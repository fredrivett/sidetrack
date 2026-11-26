"use client";

import { Check, ChevronDown, CircleCheck, Moon } from "lucide-react";
import { useId, useRef, useTransition } from "react";
import { closeDayAction } from "@/app/actions";
import type { WrapUp } from "@/core/dayWrapUps";
import { joinTagged, splitTagged, WRAP_UP_TAGS, type WrapUpTag } from "@/lib/dayTags";
import { NOTE_MAX } from "@/lib/greetingPrefs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { runAction } from "./run-action";
import { useDraft } from "./use-draft";
import { useStoredState } from "./use-stored-state";
import { WhatsLeft } from "./WhatsLeft";

/** "21:40", as the greeting's own times read. */
const clockTime = (ts: number) => new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/**
 * Close the day: how it went, as moods and a few words, for the people the
 * viewer shares their day with. It folds open under the day's note, as that
 * does; shut, it shows the wrap-up once the day's closed. Holds while it
 * saves (the server cleans the words up), then folds shut. What's picked and
 * typed is a draft until then. Before it's closed, it also offers what's
 * left of the day new days (WhatsLeft).
 */
export function CloseDayPanel({
  today,
  wrapUp,
  onClosed,
}: {
  /** The viewer's day (YYYY-MM-DD), which the draft is kept under. */
  today: string;
  /** Today's wrap-up, when the day's already closed: this edits it. */
  wrapUp: WrapUp | null;
  onClosed: (wrapUp: WrapUp) => void;
}) {
  const saved = splitTagged(wrapUp?.text ?? "", WRAP_UP_TAGS);
  const words = useDraft(`day:${today}:wrap-up`, saved.rest);
  // Moods picked but not saved yet; null while they're as saved.
  const [picked, setPicked] = useStoredState<WrapUpTag[] | null>(`draft:day:${today}:wrap-up-tags`, null);
  const tags = picked ?? saved.tags;
  const [saving, start] = useTransition();
  const [open, setOpen] = useStoredState("greeting:close-day-open", false, "session");
  const bodyId = useId();
  const header = useRef<HTMLButtonElement>(null);
  const hintId = useId();
  const unsaved = picked !== null || words.value.trim() !== saved.rest;
  // Closing it needs no words; once it's closed, Save only shows for a change.
  const canSave = !wrapUp || unsaved;

  const toggle = (tag: WrapUpTag) => {
    if (saving) return;
    const next = tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag];
    const same = next.length === saved.tags.length && next.every((t) => saved.tags.includes(t));
    setPicked(same ? null : next);
  };
  const discard = () => {
    if (saving) return;
    words.clear();
    setPicked(null);
  };
  const close = () => {
    if (saving || !canSave) return;
    start(async () => {
      const done = await runAction(
        closeDayAction(joinTagged(tags, words.value, WRAP_UP_TAGS)).then(onClosed),
        "close your day",
      );
      // A failed save keeps the draft, and the panel open.
      if (!done) return;
      words.clear();
      setPicked(null);
      // Back to its header, as the textarea and Save go with the fold.
      header.current?.focus();
      setOpen(false);
    });
  };

  return (
    <div className="mt-2 rounded-xl bg-stone-100 px-3 py-2.5 dark:bg-stone-800/50">
      {/* One fixed-height row in every state, so the buttons appearing don't move anything. */}
      <div className="flex h-6 items-center gap-2 touch:h-8">
        <button
          ref={header}
          type="button"
          onClick={() => !saving && setOpen(!open)}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md text-left text-sm text-neutral-600 outline-none hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-stone-300 dark:text-neutral-400 dark:hover:text-neutral-100 dark:focus-visible:ring-stone-600"
        >
          {wrapUp ? (
            <>
              <CircleCheck aria-hidden className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span className="shrink-0">Day closed {clockTime(wrapUp.closedAt)}</span>
            </>
          ) : (
            <>
              <Moon aria-hidden className="size-3.5 shrink-0 text-stone-400 dark:text-stone-500" />
              <span className="shrink-0">Close the day</span>
            </>
          )}
          {/* Shut, the wrap-up shows beside it: its moods as badges, then its words. */}
          {!open && saved.tags.map((tag) => (
            <span
              key={tag}
              className="shrink-0 rounded-full border border-stone-200 bg-white px-1.5 text-[11px] leading-4 text-neutral-600 dark:border-stone-700 dark:bg-neutral-900 dark:text-neutral-300"
            >
              {tag}
            </span>
          ))}
          {!open && saved.rest && (
            <span className="min-w-0 truncate italic text-neutral-400 dark:text-neutral-500">{saved.rest}</span>
          )}
          {!open && unsaved && <span className="shrink-0 text-xs text-amber-700 dark:text-amber-400">Not saved</span>}
          {!(open && canSave) && (
            <ChevronDown
              aria-hidden
              className={`ml-auto size-3.5 shrink-0 transition-transform duration-300 ease-out motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
            />
          )}
        </button>
        {/* Open with something to save: the buttons take the chevron's place. */}
        {open && canSave && (
          <div className="flex shrink-0 items-center gap-1">
            {unsaved && (
              <Button
                size="xs"
                variant="outline"
                onClick={discard}
                aria-disabled={saving || undefined}
                // Its edge shows on the tint, so it reads the same size as Save.
                className="border-stone-300 bg-transparent aria-disabled:pointer-events-none aria-disabled:opacity-60 dark:border-stone-700 dark:bg-transparent"
              >
                Discard
              </Button>
            )}
            <Button
              size="xs"
              onClick={close}
              aria-disabled={saving || undefined}
              className="aria-disabled:pointer-events-none aria-disabled:opacity-60"
            >
              <Check aria-hidden />
              {saving ? "Saving…" : wrapUp ? "Save" : "Done for today"}
            </Button>
          </div>
        )}
      </div>
      {/* Rows 0fr to 1fr animates to the content's height; folded, it's inert. */}
      <div
        id={bodyId}
        inert={!open}
        aria-busy={saving || undefined}
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        {/* -mx-1 px-1 and pb-1 leave room for the focus rings. */}
        <div className="-mx-1 min-h-0 overflow-hidden">
          <div className={`px-1 pt-2.5 pb-1 transition-opacity ${saving ? "opacity-60" : ""}`}>
            <Textarea
              draft={words}
              aria-label="How did today go?"
              aria-describedby={hintId}
              placeholder="A few words about how it went, if you like"
              rows={2}
              // What's left once the moods are in, as the server counts it.
              maxLength={NOTE_MAX - (tags.length ? joinTagged(tags, "x", WRAP_UP_TAGS).length - 1 : 0)}
              readOnly={saving}
              onChange={(e) => words.set(e.target.value.replace(/\s*\n\s*/g, " "))}
              onKeyDown={(e) => {
                // Enter saves, as the button does; the words are one line, so they wrap rather than break.
                if (e.key === "Enter") {
                  e.preventDefault();
                  close();
                }
                if (e.key === "Escape") discard();
              }}
              className="min-h-14 resize-none border-transparent bg-white text-sm dark:bg-neutral-950"
            />
            <div role="group" aria-label="How today went" className="mt-2.5 flex flex-wrap gap-1.5">
              {WRAP_UP_TAGS.map((tag) => {
                const on = tags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    aria-pressed={on}
                    aria-disabled={saving || undefined}
                    onClick={() => toggle(tag)}
                    className={`rounded-full border px-2 py-0.5 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-neutral-300 aria-disabled:pointer-events-none touch:py-1 dark:focus-visible:ring-neutral-600 ${
                      on
                        ? "border-stone-400 bg-stone-200 text-stone-900 hover:bg-stone-300/70 dark:border-stone-500 dark:bg-stone-700 dark:text-stone-50 dark:hover:bg-stone-600"
                        : "border-stone-200 bg-white text-neutral-500 hover:border-stone-300 hover:text-neutral-800 dark:border-stone-800 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:border-stone-700 dark:hover:text-neutral-100"
                    }`}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
            <p id={hintId} className="mt-2.5 text-xs text-neutral-500 dark:text-neutral-400">
              Whoever you share your day with sees this beside your note for today.
            </p>
            {/* Before it's closed: what's left of the day, to give new days. */}
            {!wrapUp && <WhatsLeft today={today} ask={open} />}
          </div>
        </div>
      </div>
    </div>
  );
}
