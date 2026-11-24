"use client";

import { useTransition } from "react";
import { closeDayAction } from "@/app/actions";
import type { WrapUp } from "@/core/dayWrapUps";
import { joinTagged, splitTagged, WRAP_UP_TAGS, type WrapUpTag } from "@/lib/dayTags";
import { NOTE_MAX } from "@/lib/greetingPrefs";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogCloseButton,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Textarea } from "@/components/ui/textarea";
import { runAction } from "./run-action";
import { useDraft } from "./use-draft";
import { useStoredState } from "./use-stored-state";

/**
 * Close the day: how it went, as moods and a few words, for the people the
 * viewer shares their day with. Holds while it saves (the server cleans the
 * words up), then closes. What's picked and typed is a draft until then.
 */
export function CloseDayDialog({
  open,
  onOpenChange,
  today,
  wrapUp,
  onClosed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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

  const toggle = (tag: WrapUpTag) => {
    if (saving) return;
    const next = tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag];
    const same = next.length === saved.tags.length && next.every((t) => saved.tags.includes(t));
    setPicked(same ? null : next);
  };
  const close = () =>
    start(async () => {
      const done = await runAction(
        closeDayAction(joinTagged(tags, words.value, WRAP_UP_TAGS)).then(onClosed),
        "close your day",
      );
      // A failed save keeps the draft, and the dialog open.
      if (!done) return;
      words.clear();
      setPicked(null);
      onOpenChange(false);
    });

  return (
    <ResponsiveDialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <ResponsiveDialogContent>
        <div className="flex shrink-0 items-start gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <div className="min-w-0 flex-1">
            <ResponsiveDialogTitle>How did today go?</ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-sm text-neutral-500">
              Whoever you share your day with sees this beside your note for today.
            </ResponsiveDialogDescription>
          </div>
          <ResponsiveDialogCloseButton className="shrink-0" />
        </div>
        <div aria-busy={saving || undefined} className={`space-y-3 px-4 py-3 transition-opacity ${saving ? "opacity-60" : ""}`}>
          <div role="group" aria-label="How today went" className="flex flex-wrap gap-1.5">
            {WRAP_UP_TAGS.map((tag) => {
              const on = tags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  aria-pressed={on}
                  aria-disabled={saving || undefined}
                  onClick={() => toggle(tag)}
                  className={`rounded-full border px-2.5 py-1 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-neutral-300 dark:focus-visible:ring-neutral-600 ${
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
          <Textarea
            draft={words}
            aria-label="A few words about today"
            placeholder="A few words about today, if you like"
            rows={3}
            // What's left once the moods are in, as the server counts it.
            maxLength={NOTE_MAX - (tags.length ? joinTagged(tags, "x", WRAP_UP_TAGS).length - 1 : 0)}
            readOnly={saving}
            onChange={(e) => words.set(e.target.value.replace(/\s*\n\s*/g, " "))}
            className="resize-none text-sm"
          />
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <Button
            onClick={() => !saving && close()}
            aria-disabled={saving || undefined}
            className="aria-disabled:opacity-60"
          >
            {saving ? "Saving…" : wrapUp ? "Save" : "Done for today"}
          </Button>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
