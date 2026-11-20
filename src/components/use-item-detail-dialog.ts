"use client";

import { useState } from "react";
import type { Item } from "@/core/schema";
import { useHydrated, useStoredState } from "./use-stored-state";

/** The item open in a dialog in this tab, kept so a reload can reopen it. */
const SHOWN_KEY = "item-dialog";

/**
 * Where an item dialog has been: the item it shows (`id`, null for none),
 * and the ones it went there from, to go back to. Going to the one it just
 * came from goes back instead, so parent, sub-item, parent doesn't pile up.
 * Ones that have gone since (deleted, say) are skipped. `direction` is the
 * way the last move went, for ResponsiveDialogViews, and `left` the one it
 * went back from, to focus where it was opened from.
 */
export function useItemTrail(has: (id: string) => boolean, initial: string | null = null) {
  const [state, setState] = useState({
    id: initial,
    trail: [] as string[],
    direction: "forward" as "forward" | "back",
    left: null as string | null,
  });
  const trail = state.trail.filter(has);
  const previousId = trail.at(-1) ?? null;
  const back = () =>
    setState({ id: previousId, trail: trail.slice(0, -1), direction: "back", left: state.id });
  return {
    id: state.id,
    previousId,
    direction: state.direction,
    left: state.left,
    back,
    goTo(id: string) {
      if (id === state.id) return;
      if (id === previousId) return back();
      setState({
        id,
        trail: state.id ? [...trail, state.id] : trail,
        direction: "forward",
        left: null,
      });
    },
    /** Shows none, keeping the rest as it was while the dialog animates out. */
    close() {
      setState((s) => ({ ...s, id: null }));
    },
    /** Starts afresh at `id`, with nothing to go back to. */
    reset(id: string | null) {
      setState({ id, trail: [], direction: "forward", left: null });
    },
  };
}

/**
 * Open-state for the item detail dialog, lifted above the list/done split so
 * it survives an item moving between them (reopened from Done, or the day
 * turning over) — the row that triggered the dialog unmounts, but this state
 * does not.
 *
 * `item` is looked up live by id against the current `items`, so edits and
 * complete-toggles show in the open dialog immediately. `closingItem` keeps the
 * snapshot captured when the row was clicked, so the dialog can animate out
 * once the live item is gone (closed or deleted) instead of vanishing on
 * unmount. The snapshot is set in the open handler — not derived in render or
 * an effect — to stay clear of the no-ref-in-render / no-setState-in-effect
 * lint rules.
 *
 * Opening an item from the page starts afresh; going to another from the
 * dialog (`goTo`: a sub-item or the parent) can be gone back from (`history`).
 *
 * Every dialog records the item it shows for this tab, wherever it was opened
 * from. The one with `restore` (the board's) reopens that item after a
 * reload: a deploy's, a manual one, or the phone closing the app in the
 * background. A `?item=` link wins over it.
 */
export function useItemDetailDialog(
  items: Item[],
  initialItemId: string | null = null,
  restore = false,
) {
  const find = (id: string | null) => (id ? (items.find((i) => i.id === id) ?? null) : null);
  // Only an item on the board: one hidden now (archived, say) mustn't pop
  // open later when a view shows it.
  const [closingItem, setClosingItem] = useState<Item | null>(() => find(initialItemId));
  const trail = useItemTrail((id) => find(id) !== null, closingItem?.id ?? null);
  const openItem = find(trail.id);
  const previous = find(trail.previousId);

  const [shown, setShown] = useStoredState<string | null>(SHOWN_KEY, null, "session");
  // Storage is only readable once hydrated, so restore on the first render
  // after it, during render rather than in an effect, and only then: a later
  // value is a dialog opened elsewhere on the page, already showing.
  const hydrated = useHydrated();
  const [restored, setRestored] = useState(!restore);
  if (hydrated && !restored) {
    setRestored(true);
    const item = initialItemId ? null : find(shown);
    if (item) {
      setClosingItem(item);
      trail.reset(item.id);
    }
  }

  return {
    item: openItem ?? closingItem,
    open: openItem !== null,
    openDetail(item: Item) {
      setClosingItem(item);
      trail.reset(item.id);
      setShown(item.id);
    },
    goTo(item: Item) {
      setClosingItem(item);
      trail.goTo(item.id);
      setShown(item.id);
    },
    history: {
      previous,
      direction: trail.direction,
      left: trail.left,
      onBack() {
        if (previous) setClosingItem(previous);
        trail.back();
        setShown(previous?.id ?? null);
      },
    },
    onOpenChange(next: boolean) {
      if (next) return;
      trail.close();
      setShown(null);
    },
  };
}

export type ItemHistory = ReturnType<typeof useItemDetailDialog>["history"];
