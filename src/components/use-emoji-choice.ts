"use client";

import { useEffect, useEffectEvent, useState } from "react";

// Every emoji that goes with a title (a list's icon, a label's emoji) works
// the same way. Until someone chooses one, it's Jev's top suggestion for the
// title: shown faded in the views that add or edit it (not on the board),
// and replaced as the title is typed or renamed. Once someone chooses one,
// or chooses none, that always stays. Saved lists and labels store which it
// is (iconChosen, emojiChosen); a title still being written holds it until
// it's created.

/** Wait for a pause in typing before asking for suggestions. */
const SUGGEST_DELAY_MS = 400;

export interface EmojiChoice {
  emoji: string | null;
  /** Someone chose `emoji`, or chose none (null). */
  chosen: boolean;
}

/** Nothing chosen yet, and nothing suggested: a new title's start. */
export const UNCHOSEN: EmojiChoice = { emoji: null, chosen: false };

/**
 * Jev's emoji for `context`, a key for what it reads (such as the title),
 * most likely first. Asked after a pause in typing, and only while `enabled`.
 * [] until it answers for this context, and when AI is off. An answer for
 * older text is never used.
 */
export function useEmojiSuggestions(
  context: string,
  suggest: (signal: AbortSignal) => Promise<string[]>,
  enabled: boolean,
): string[] {
  const [answered, setAnswered] = useState<{ for: string; emoji: string[] } | null>(null);
  const ask = useEffectEvent(suggest);
  const known = answered?.for === context;
  useEffect(() => {
    if (!enabled || known) return;
    // Newer text gives up on the answer for this, and stops Jev's work on it.
    const stale = new AbortController();
    const timer = setTimeout(() => {
      // A suggestion that fails is just left out.
      ask(stale.signal).then(
        (emoji) => {
          if (!stale.signal.aborted) setAnswered({ for: context, emoji });
        },
        () => {},
      );
    }, SUGGEST_DELAY_MS);
    return () => {
      stale.abort();
      clearTimeout(timer);
    };
  }, [enabled, known, context]);
  return known ? answered.emoji : [];
}

/**
 * What an emoji + title shows: the saved or held choice when someone made
 * one, else `auto`, the suggestion for the title as it reads now (null for
 * none, as when a list's homepage favicon shows instead). `auto` undefined
 * means there's no newer suggestion, so the saved one stands. `faded` marks
 * an emoji nobody chose.
 */
export function shownEmoji(
  saved: EmojiChoice,
  auto: string | null | undefined,
): EmojiChoice & { faded: boolean } {
  const emoji = saved.chosen || auto === undefined ? saved.emoji : auto;
  return { emoji, chosen: saved.chosen, faded: !saved.chosen && emoji !== null };
}

/**
 * The emoji to save with a title change, so the save keeps what was shown:
 * the suggestion for the new title when nobody chose one and it has come
 * back. Undefined otherwise; the server then asks Jev itself, so a save made
 * before the suggestion lands still gets one.
 */
export function autoEmojiToSave(
  saved: EmojiChoice,
  auto: string | null | undefined,
): EmojiChoice | undefined {
  return saved.chosen || auto === undefined ? undefined : { emoji: auto, chosen: false };
}

/**
 * An emoji + title, with the title perhaps being typed (see the top of this
 * file). `saved` is the saved or held choice, suggested for `savedTitle`
 * (null for a title not created yet, whose suggestion always shows). Pass
 * `onDraftChange` to the title's EditableText and save a rename with
 * `toSave()`, so an emoji nobody chose follows the new title as it's typed
 * and is saved with it. `none` shows no suggestion, as when a list's
 * homepage favicon shows instead. Suggestions also load once the picker
 * opens, for its Suggested row.
 */
export function useTitleEmoji({
  saved,
  title,
  savedTitle,
  context = [],
  suggest,
  none = false,
}: {
  saved: EmojiChoice;
  title: string;
  savedTitle: string | null;
  /** Whatever else Jev reads, so a change to it asks again. */
  context?: unknown[];
  suggest: (title: string, signal: AbortSignal) => Promise<string[]>;
  none?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);
  const current = draft?.trim() || title;
  const fresh = current !== savedTitle;
  const suggestions = useEmojiSuggestions(
    JSON.stringify([current, ...context]),
    (signal) => suggest(current, signal),
    Boolean(current) && (opened || (fresh && !saved.chosen && !none)),
  );
  const auto = !fresh ? undefined : none ? null : suggestions[0];
  return {
    shown: shownEmoji(saved, auto),
    suggestions,
    onOpen: () => setOpened(true),
    onDraftChange: setDraft,
    /** The emoji to save with the title as it now reads, if it changes. */
    toSave: () => autoEmojiToSave(saved, auto),
  };
}
