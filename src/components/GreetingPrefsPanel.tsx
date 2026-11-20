"use client";

import { unstable_rethrow } from "next/navigation";
import posthog from "posthog-js";
import { useState, useTransition } from "react";
import { setGreetingPrefsAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useDraft } from "@/components/use-draft";
import {
  cleanNote,
  GREETING_LENGTHS,
  type GreetingLength,
  type GreetingPrefs,
  NOTE_MAX,
} from "@/lib/greetingPrefs";

const LENGTH: Record<GreetingLength, { label: string; hint: string }> = {
  short: { label: "Short", hint: "Just the main thing." },
  medium: { label: "Medium", hint: "A couple of things." },
  long: { label: "Long", hint: "Everything worth saying, with what you got done." },
};

/**
 * How the viewer likes their Agenda greeting: its length, and a note in their
 * own words for Claude. Saving applies from their next greeting, so it never
 * asks for a new one.
 */
export function GreetingPrefsPanel({ initial }: { initial: GreetingPrefs }) {
  const [saved, setSaved] = useState(initial);
  const noteDraft = useDraft("greeting-note", saved.note);
  const note = noteDraft.value;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Settings panels hold while saving and report failures inline.
  function save(next: GreetingPrefs) {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const kept = await setGreetingPrefsAction(next);
        setSaved(kept);
        // Only when the note was what changed: a draft typed before
        // changing the length or sharing stays as typed.
        if (next.note !== saved.note) noteDraft.clear();
        // What people choose shapes the defaults. Never the note itself.
        posthog.capture("greeting_prefs_saved", {
          length: kept.length,
          has_note: kept.note !== "",
          share_note: kept.shareNote,
        });
      } catch (e) {
        // A signed-out session rejects with Next's redirect to /login.
        unstable_rethrow(e);
        setError("Couldn't save your greeting settings. Please try again.");
      }
    });
  }

  const noteChanged = cleanNote(note) !== saved.note;
  const h2 = "text-sm font-medium";

  return (
    <div
      className="space-y-5 rounded-lg border border-border p-4 aria-disabled:opacity-60"
      aria-disabled={pending || undefined}
    >
      <fieldset className="space-y-2">
        <legend className={h2}>Length</legend>
        <div role="radiogroup" aria-label="Length" className="flex gap-1.5">
          {GREETING_LENGTHS.map((l) => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={saved.length === l}
              aria-disabled={pending || undefined}
              onClick={() => saved.length !== l && save({ ...saved, length: l })}
              className={`rounded-md border px-3 py-1.5 text-sm transition ${
                saved.length === l
                  ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
                  : "border-border hover:bg-accent"
              }`}
            >
              {LENGTH[l].label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{LENGTH[saved.length].hint}</p>
      </fieldset>

      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (noteChanged) save({ ...saved, note });
        }}
      >
        <label htmlFor="greeting-note" className={`block ${h2}`}>
          In your own words
        </label>
        <Textarea
          id="greeting-note"
          draft={noteDraft}
          // Capped by characters, as it's kept, so an emoji counts once.
          onChange={(e) => noteDraft.set(Array.from(e.target.value).slice(0, NOTE_MAX).join(""))}
          placeholder="Keep it brief. Don't mention what slipped."
          aria-describedby="greeting-note-hint"
        />
        <p id="greeting-note-hint" className="text-xs text-muted-foreground">
          Claude follows it when it writes your greeting, within its own rules. {Array.from(note).length}/
          {NOTE_MAX}
        </p>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={saved.shareNote}
            aria-disabled={pending || undefined}
            onChange={(e) => save({ ...saved, shareNote: e.target.checked })}
            className="mt-0.5 size-4 accent-neutral-900 dark:accent-neutral-100"
          />
          <span>
            Share this note to help improve the greeting
            <span className="block text-xs text-muted-foreground">
              We may read shared notes to shape how the greeting works for everyone.
            </span>
          </span>
        </label>
        <Button type="submit" size="sm" disabled={!noteChanged}>
          Save note
        </Button>
      </form>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Changes apply from your next greeting: each morning, afternoon and evening has its own.
      </p>
    </div>
  );
}
