"use client";

import { useCallback, useMemo, useState } from "react";
import { readStored, removeStored, useStoredState, writeStored } from "./use-stored-state";

// Text people type outlives a reload: a deploy's, a manual one, or the phone
// closing the app in the background. Every text field that holds writing
// (Textarea, MentionTextarea, multi-line EditableText) takes a Draft, and
// only useDraft makes one, so each field decides where its text is kept.
// See "Drafts" in AGENTS.md.

declare const drafted: unique symbol;

/** Text being written in a field. Make one with useDraft. */
export type Draft = {
  readonly value: string;
  set(next: string): void;
  readonly [drafted]: true;
};

/** What useDraft gives the component that owns the text. */
export type DraftState = Draft & {
  set(next: string | ((current: string) => string)): void;
  /** Forgets the draft: call it once the text is saved, or abandoned. */
  clear(): void;
};

type Kept = { text: string; base: string; at: number };

const PREFIX = "draft:";
const OWNER = "drafts-owner";
/** A draft untouched this long is dropped. */
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const NONE: Kept | null = null;

/**
 * The text a field holds, kept in localStorage under `key` until it's
 * cleared, or for a null key in memory only, as plain state.
 *
 * `base` is the saved text the field starts from ("" for something new).
 * The draft is only shown while `base` is what it was written against: if
 * the saved text changes meanwhile (someone else edited it, or the edit was
 * saved), the draft is dropped rather than put back over it. Setting it back
 * to `base` removes it.
 */
export function useDraft(key: string | null, base = ""): DraftState {
  // Always called, as hooks must be; a null key never writes, so this reads
  // nothing.
  const [stored, setStored] = useStoredState(PREFIX + (key ?? ""), NONE);
  const [memory, setMemory] = useState<Kept | null>(null);
  const kept = key ? stored : memory;
  const value = kept && kept.base === base ? kept.text : base;

  const set = useCallback(
    (next: string | ((current: string) => string)) => {
      const update = (cur: Kept | null): Kept | null => {
        const current = cur && cur.base === base ? cur.text : base;
        const text = typeof next === "function" ? next(current) : next;
        return text === base ? null : { text, base, at: Date.now() };
      };
      if (key) setStored(update);
      else setMemory(update);
    },
    [key, base, setStored],
  );
  const clear = useCallback(() => {
    if (key) setStored(null);
    else setMemory(null);
  }, [key, setStored]);

  // Only this hook makes Drafts, which is what the brand is for.
  return useMemo(() => ({ value, set, clear }) as DraftState, [value, set, clear]);
}

/**
 * Drafts belong to the person who wrote them. Call with the signed-in user
 * when the board loads: drafts left by someone else on this browser, and
 * any untouched for a week, are dropped.
 */
export function claimDrafts(userId: string) {
  const owner = readStored("local", OWNER);
  const mine = owner === JSON.stringify(userId);
  removeStored("local", PREFIX, (raw) => {
    if (!mine) return true;
    try {
      const at = (JSON.parse(raw) as Partial<Kept>).at;
      return typeof at === "number" && Date.now() - at > KEEP_MS;
    } catch {
      return true;
    }
  });
  if (!mine) writeStored("local", OWNER, userId);
}

/** Drops every draft, as signing out does. */
export function forgetDrafts() {
  removeStored("local", PREFIX, () => true);
  writeStored("local", OWNER, null);
}
