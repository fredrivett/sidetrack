"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

/**
 * Where a value lives: "local" until it's cleared, in every tab and across
 * restarts, as for a draft; "session" in this tab only, until it closes, as
 * for what the page has open.
 */
export type Store = "local" | "session";

const PREFIX = "sidetrack:";

// Writes in this tab; the storage event only tells the other tabs.
const listeners = new Set<() => void>();
// Values the browser wouldn't store (storage blocked or full), kept for this
// page's life so the state still works, just without outliving it.
const fallback = new Map<string, string | null>();

function storageFor(store: Store): Storage | null {
  try {
    return store === "local" ? localStorage : sessionStorage;
  } catch {
    return null;
  }
}

function read(store: Store, key: string): string | null {
  const id = `${store}:${key}`;
  if (fallback.has(id)) return fallback.get(id) ?? null;
  try {
    return storageFor(store)?.getItem(PREFIX + key) ?? null;
  } catch {
    return null;
  }
}

function write(store: Store, key: string, raw: string | null) {
  const id = `${store}:${key}`;
  try {
    const storage = storageFor(store);
    if (!storage) throw new Error("No storage");
    if (raw === null) storage.removeItem(PREFIX + key);
    else storage.setItem(PREFIX + key, raw);
    fallback.delete(id);
  } catch {
    fallback.set(id, raw);
  }
  for (const l of listeners) l();
}

/** The stored value under `key`, as JSON, outside a component. */
export function readStored(store: Store, key: string): string | null {
  return read(store, key);
}

/** Stores `value` under `key` outside a component, or removes it for null. */
export function writeStored(store: Store, key: string, value: unknown) {
  write(store, key, value === null ? null : JSON.stringify(value));
}

/** Removes every value whose key starts with `prefix` and that `drop`
 * picks, given its JSON, telling everything that shows them. */
export function removeStored(store: Store, prefix: string, drop: (raw: string) => boolean) {
  const keys = new Set<string>();
  for (const id of fallback.keys()) {
    if (id.startsWith(`${store}:${prefix}`)) keys.add(id.slice(store.length + 1));
  }
  try {
    const storage = storageFor(store);
    for (let i = 0; storage && i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(PREFIX + prefix)) keys.add(key.slice(PREFIX.length));
    }
  } catch {
    // Unreadable storage holds nothing to remove.
  }
  for (const key of keys) {
    const raw = read(store, key);
    if (raw !== null && drop(raw)) write(store, key, null);
  }
}

const noSubscribe = () => () => {};

/** False for the server render and hydration, true after: until then the
 * stored values aren't showing (useStoredState renders `initial`). */
export function useHydrated(): boolean {
  return useSyncExternalStore(noSubscribe, () => true, () => false);
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    removeEventListener("storage", onChange);
  };
}

function parse<T>(raw: string | null, initial: T): T {
  if (raw === null) return initial;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return initial;
  }
}

/**
 * Like useState, but kept in the browser's storage under `key`, so it
 * outlives a reload: a deploy's, a crash, or the phone closing the app in the
 * background. The server render and hydration use `initial`, and the stored
 * value takes over straight after. Setting it back to `initial` removes it.
 *
 * `initial` must keep its identity between renders (a constant, not an
 * inline `[]`), as the value is only worked out again when it changes.
 */
export function useStoredState<T>(key: string, initial: T, store: Store = "local") {
  const raw = useSyncExternalStore(
    subscribe,
    () => read(store, key),
    () => null,
  );
  const value = useMemo(() => parse(raw, initial), [raw, initial]);
  const set = useCallback(
    (next: T | ((current: T) => T)) => {
      const value =
        typeof next === "function"
          ? (next as (current: T) => T)(parse(read(store, key), initial))
          : next;
      const raw = JSON.stringify(value);
      write(store, key, raw === JSON.stringify(initial) ? null : raw);
    },
    [store, key, initial],
  );
  return [value, set] as const;
}
