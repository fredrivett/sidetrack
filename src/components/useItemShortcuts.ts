"use client";

import { createContext, useEffect, useSyncExternalStore } from "react";
import { isEditableTarget, matchesShortcut } from "@/lib/keyboard";

/**
 * The item the board's arrow keys (or HJKL) selected, or null, and how to
 * change it. While there is one, it owns the item shortcuts rather than the
 * hovered item. A store rather than a value, so moving the selection
 * re-renders only the rows it leaves and reaches (useRowSelection), not every
 * row on the board.
 */
export function createSelection() {
  let selectedId: string | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => selectedId,
    select(id: string | null) {
      if (id === selectedId) return;
      selectedId = id;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
export type Selection = ReturnType<typeof createSelection>;

/** The board's selection. Null outside the board. */
export const SelectedItemContext = createContext<Selection | null>(null);

const noSelection = () => () => {};

/**
 * Whether the item is the one selected, and whether it owns the item
 * shortcuts: the selected item while there is one, else the hovered one. A
 * row that isn't hovered only changes when it gains or loses the selection.
 */
export function useRowSelection(
  selection: Selection | null,
  itemId: string,
  hovered: boolean,
): { selected: boolean; owns: boolean } {
  // 2: this item is selected; 1: another is, and this one is hovered; 0: neither.
  const state = useSyncExternalStore(
    selection?.subscribe ?? noSelection,
    () => {
      const id = selection?.get() ?? null;
      return id === itemId ? 2 : id !== null && hovered ? 1 : 0;
    },
    () => 0,
  );
  return { selected: state === 2, owns: state === 2 || (state === 0 && hovered) };
}

/** Linear's assignment shortcuts: A opens the assignee picker, I toggles me. */
export const OPEN_ASSIGNEE_SHORTCUT = { key: "a" } as const;
export const ASSIGN_TO_ME_SHORTCUT = { key: "i" } as const;

/**
 * Arm Linear-style item shortcuts on the item that currently "owns" them:
 * `A` opens the assignee picker, `I` adds the viewer to the item's assignees
 * (or takes them off if they're already on it), `D` opens its due date, `X`
 * ticks it done or not, ⌫ (or Delete) deletes it, asking first, and ↵ opens
 * it.
 *
 * `active` arms a document-level key listener — pass the condition under which
 * this item should own the shortcuts (a hovered or selected card, an open
 * detail dialog, …), and disarm it while the picker itself is open so the menu
 * keeps its own keyboard handling. Set `deferToDialog` on a card so a
 * still-hovered row behind an open dialog yields to that dialog ([role=dialog])
 * rather than acting on the wrong item. `onAssignToMe` is omitted when the
 * viewer can't assign themselves (not a candidate on this project), which also
 * drops the `I` binding; any other handler left out drops its key too.
 */
export function useItemShortcuts({
  active,
  deferToDialog,
  onOpenPicker,
  onAssignToMe,
  onDue,
  onToggleDone,
  onCancel,
  onDelete,
  onOpen,
}: {
  active: boolean;
  deferToDialog?: boolean;
  onOpenPicker?: () => void;
  onAssignToMe?: () => void;
  onDue?: () => void;
  onToggleDone?: () => void;
  /** ⇧X: opens the cancel dialog (CancelItemDialog), never cancels at once. */
  onCancel?: () => void;
  onDelete?: () => void;
  onOpen?: () => void;
}) {
  useEffect(() => {
    if (!active) return;
    function onKeyDown(e: KeyboardEvent) {
      if (isEditableTarget(e.target)) return;
      // Inside any other menu (the row's right-click menu, the dialog's parent
      // picker), letters belong to that menu's typeahead. Assignee pickers
      // carry data-assignee-picker so their own I hint still works.
      const menu = (e.target as Element | null)?.closest?.('[role="menu"]');
      if (menu && !menu.hasAttribute("data-assignee-picker")) return;
      // Bare keys only — never shadow ⌘A / Ctrl+A (select all) and friends.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // A hovered card behind an open dialog must not steal the shortcut from
      // the dialog, which renders a [role=dialog] popup over it.
      if (deferToDialog && document.querySelector('[role="dialog"]')) return;
      let run: (() => void) | undefined;
      if (matchesShortcut(e, OPEN_ASSIGNEE_SHORTCUT)) run = onOpenPicker;
      else if (matchesShortcut(e, ASSIGN_TO_ME_SHORTCUT)) run = onAssignToMe;
      // The rest act on the item itself, so not from inside an assignee picker.
      else if (menu) return;
      else if (matchesShortcut(e, { key: "d" })) run = onDue;
      else if (matchesShortcut(e, { key: "x", shift: false })) run = onToggleDone;
      else if (matchesShortcut(e, { key: "x", shift: true })) run = onCancel;
      else if (e.key === "Backspace" || e.key === "Delete") run = onDelete;
      else if (e.key === "Enter" && !e.shiftKey) run = onOpen;
      if (!run || e.repeat) return;
      e.preventDefault();
      run();
    }
    // Capture phase: while an assignee picker is open its menu has focus, and
    // base-ui's typeahead stops every letter key from bubbling, which would
    // swallow the I its "me" row advertises.
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [active, deferToDialog, onOpenPicker, onAssignToMe, onDue, onToggleDone, onCancel, onDelete, onOpen]);
}

/** The board's movement keys: the arrows, and Vim's HJKL. */
export const NAV_KEYS: Record<string, "up" | "down" | "left" | "right"> = {
  ArrowUp: "up",
  k: "up",
  ArrowDown: "down",
  j: "down",
  ArrowLeft: "left",
  h: "left",
  ArrowRight: "right",
  l: "right",
};

/**
 * The row the movement keys go to from the selected item: up and down within
 * its list, left and right to the same place in the next list with items, or
 * its last item if that list is shorter, or, when that place isn't rendered
 * (a long list scrolled elsewhere), its row nearest the same height on
 * screen. Views that don't group by list are
 * one column. With nothing selected (or it's gone), the hovered row, else the
 * first one on screen. Null when there are no rows.
 */
export function stepItemRow(
  selectedId: string | null,
  dir: (typeof NAV_KEYS)[string],
): HTMLElement | null {
  const rows = [...document.querySelectorAll<HTMLElement>("[data-item-row]")].filter(
    (r) => !r.closest('[role="dialog"]'),
  );
  const current = rows.find((r) => r.dataset.itemRow === selectedId);
  if (!current) {
    const onScreen = (r: HTMLElement) => {
      const b = r.getBoundingClientRect();
      return b.left >= 0 && b.right <= innerWidth && b.bottom > 0 && b.top < innerHeight;
    };
    return rows.find((r) => r.matches(":hover")) ?? rows.find(onScreen) ?? rows[0] ?? null;
  }
  // Rows by list, lists in board order (the DOM's, left to right).
  const columns = new Map<Element | null, HTMLElement[]>();
  for (const r of rows) {
    const col = r.closest("[data-project-id]");
    columns.set(col, [...(columns.get(col) ?? []), r]);
  }
  const lists = [...columns.values()];
  const at = lists.findIndex((l) => l.includes(current));
  const i = lists[at].indexOf(current);
  if (dir === "up") return lists[at][i - 1] ?? current;
  if (dir === "down") return lists[at][i + 1] ?? current;
  const next = lists[at + (dir === "left" ? -1 : 1)];
  if (!next) return current;
  // A long list renders only the rows near its view, each marked with its
  // place in the list (useVirtualRows), so places go by that.
  const place = (r: HTMLElement, rendered: HTMLElement[]) =>
    Number(r.closest<HTMLElement>("[data-list-index]")?.dataset.listIndex ?? rendered.indexOf(r));
  const want = place(current, lists[at]);
  const same = next.find((r) => place(r, next) === want);
  if (same) return same;
  // A list that renders every row is shorter: its last one.
  if (!next[0].closest("[data-list-index]")) return next[next.length - 1];
  // A long list scrolled elsewhere: its row at the same height on screen.
  const middle = (r: HTMLElement) => {
    const b = r.getBoundingClientRect();
    return (b.top + b.bottom) / 2;
  };
  const y = middle(current);
  return next.reduce((best, r) => (Math.abs(middle(r) - y) < Math.abs(middle(best) - y) ? r : best));
}

/**
 * The item to select once `id` is deleted: the next one down its list, else
 * the one above, skipping its own sub-items, which go with it. Null when it
 * was the list's only item.
 */
export function rowAfterDelete(id: string): string | null {
  for (const dir of ["down", "up"] as const) {
    let at = id;
    for (;;) {
      const row = stepItemRow(at, dir);
      const next = row?.dataset.itemRow;
      if (!row || !next || next === at) break;
      if (row.dataset.parentId !== id) return next;
      at = next;
    }
  }
  return null;
}
