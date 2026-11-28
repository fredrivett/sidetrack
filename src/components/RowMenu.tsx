"use client";

import {
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
  useState,
  useSyncExternalStore,
} from "react";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { useMediaQuery } from "@/components/ui/use-media-query";

/**
 * Which row the board's one right-click menu is for, and whether it's open.
 * A board has hundreds of rows, and a menu each cost more to mount and
 * re-render than the rows themselves, so the board has one (RowMenus), and
 * only the row it's for renders its items (useRowMenu).
 */
function createRowMenuStore() {
  let row: Element | null = null;
  let open = false;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  return {
    get: () => ({ row, open }),
    forRow(el: Element | null) {
      row = el;
      emit();
    },
    setOpen(next: boolean) {
      open = next;
      emit();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
type RowMenuStore = ReturnType<typeof createRowMenuStore>;

const RowMenuContext = createContext<RowMenuStore | null>(null);

const noRowMenu = () => () => {};

/**
 * The board's right-click menu, around everything that shows item rows.
 * A right-click (or a long press) on a row, the element with
 * data-item-row, opens it for that row; anywhere else keeps the browser's
 * own menu. Without hover (touch) it's off: a long press would fight the
 * touch drag, and tapping a row opens its detail dialog, which has the same
 * actions.
 */
export function RowMenus({ children }: { children: ReactNode }) {
  const [store] = useState(createRowMenuStore);
  const canHover = useMediaQuery("(hover: hover)");
  // Picks the row before Base UI's own handler opens the menu. For anything
  // that isn't a row it skips that handler, and the trigger's document
  // listener that hides the browser's menu, so links, text and fields keep
  // theirs. Next hydrates React onto the document itself, so that listener
  // sits on the same node as React's: only stopImmediatePropagation stops
  // it, and it can because React's was added first, at hydration, before
  // Base UI's effect added its own.
  function pickRow(e: React.SyntheticEvent & { preventBaseUIHandler?: () => void }) {
    const row = e.target instanceof Element ? e.target.closest("[data-item-row]") : null;
    if (!row) {
      e.preventBaseUIHandler?.();
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      return;
    }
    store.forRow(row);
  }
  return (
    <RowMenuContext value={store}>
      <ContextMenu disabled={!canHover} onOpenChange={(open) => store.setOpen(open)}>
        <ContextMenuTrigger
          // select-auto undoes the trigger's select-none, which the board's
          // text would inherit; the rows keep it themselves.
          render={<div className="contents" />}
          className="select-auto"
          onContextMenu={pickRow}
          onTouchStart={pickRow}
          // Base UI's trigger turns off iOS's long-press callout; leave it on
          // for links on the board, and the rows turn it off themselves.
          style={{ WebkitTouchCallout: "inherit" }}
        >
          {children}
        </ContextMenuTrigger>
      </ContextMenu>
    </RowMenuContext>
  );
}

/**
 * Whether the board's right-click menu is this row's: null if not, else
 * whether it's open. The row renders the menu's items while it's its own.
 */
export function useRowMenu(row: RefObject<Element | null>): { open: boolean } | null {
  const store = useContext(RowMenuContext);
  const state = useSyncExternalStore(
    store?.subscribe ?? noRowMenu,
    () => {
      const s = store?.get();
      return !s?.row || s.row !== row.current ? 0 : s.open ? 2 : 1;
    },
    () => 0,
  );
  return state === 0 ? null : { open: state === 2 };
}
