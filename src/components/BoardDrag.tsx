"use client";

import {
  type Active,
  type Announcements,
  type CollisionDescriptor,
  type CollisionDetection,
  DndContext,
  type KeyboardCoordinateGetter,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { createContext, type ReactNode, use, useCallback, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { Item } from "@/core/schema";
import type { RowProps } from "./ItemList";
import {
  MoveItemContext,
  MoveItemDialog,
  type MoveRequest,
  type MoveTargets,
} from "./MoveItem";

/** What a list answers for drags of its own rows. */
export interface ListDrag {
  coordinateGetter: KeyboardCoordinateGetter;
  announcements: Announcements;
}

/**
 * A row on its way from list `from` into list `to`: shown there at
 * `position` (top | end | after:<id> | before:<id>, among its top-level
 * items) while it's dragged over it, and once `dropped`, faded there until
 * its move is confirmed or cancelled.
 */
export interface Incoming {
  item: Item;
  children: Item[];
  from: string;
  to: string;
  position: string;
  dropped: boolean;
  /** Its checklist folded away, as in its own list. */
  collapsed: boolean;
  /** Its own list's row props, so it shows its own ref and people. */
  row: RowProps;
}

interface BoardDragValue {
  incoming: Incoming | null;
  /** The latest, for drag handlers that run before a re-render. */
  getIncoming: () => Incoming | null;
  setIncoming: (next: Incoming | null) => void;
  /** Answers for drags of `projectId`'s rows; returns its removal. */
  register: (projectId: string, list: ListDrag) => () => void;
  /**
   * The list whose row is being, or was last, dragged: it draws the card in
   * hand. LIST_SOURCE for a list itself (ListDrag).
   */
  source: string | null;
}

const BoardDragContext = createContext<BoardDragValue | null>(null);

export function useBoardDrag() {
  const v = use(BoardDragContext);
  if (!v) throw new Error("DraggableItemList needs a BoardDrag around it");
  return v;
}

/**
 * The `home` of a whole list dragged by its header (ListDrag), so it's
 * BoardDrag's `source` meanwhile, and answers its own announcements.
 */
export const LIST_SOURCE = "list:";

/** The list a row belongs to, wherever it's shown (see DraggableItemList's rows). */
const homeOf = (active: Active | null | undefined) =>
  active?.data.current?.home as string | undefined;

export const columnEl = (projectId: string) =>
  [...document.querySelectorAll<HTMLElement>("[data-project-id]")].find(
    (el) => el.dataset.projectId === projectId,
  );

function columnAt({ x, y }: { x: number; y: number }) {
  for (const el of document.querySelectorAll<HTMLElement>("[data-project-id]")) {
    const r = el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      return el.dataset.projectId ?? null;
    }
  }
  return null;
}

// The row whose middle is nearest the dragged row's middle, by height alone.
// The dragged card's box can't stand in for the row: dnd-kit measures it with
// a parent's checklist (so its middle sits rows lower), and sideways it snaps
// to an indent, which mustn't change the row it's over. The row's own height
// comes from its placeholder in the list.
const closestRow: CollisionDetection = ({
  active,
  collisionRect,
  droppableRects,
  droppableContainers,
}) => {
  const height = droppableRects.get(active.id)?.height ?? collisionRect.height;
  const middle = collisionRect.top + height / 2;
  const hits: CollisionDescriptor[] = [];
  for (const c of droppableContainers) {
    const r = droppableRects.get(c.id);
    if (!r) continue;
    const value = Math.abs(r.top + r.height / 2 - middle);
    hits.push({ id: c.id, data: { droppableContainer: c, value } });
  }
  return hits.sort((a, b) => a.data.value - b.data.value);
};

const EASING = "cubic-bezier(0.25, 1, 0.5, 1)";

const rowsIn = (projectId: string) => [
  ...(columnEl(projectId)?.querySelectorAll<HTMLElement>("[data-row-id]") ?? []),
];

/**
 * Takes a dropped row back out of the list it was dropped in (`clear`), as
 * if the drag were undone: the gap it leaves closes, one opens in its own
 * list, and a copy of it glides from one to the other.
 */
function glideBack(incoming: Incoming, clear: () => void) {
  const ids = new Set([incoming.item.id, ...incoming.children.map((c) => c.id)]);
  const lists = [incoming.from, incoming.to];
  const before = new Map(
    lists.flatMap(rowsIn).map((el) => [el.dataset.rowId, el.getBoundingClientRect()]),
  );
  const ghosts = rowsIn(incoming.to).flatMap((el) => {
    const id = el.dataset.rowId ?? "";
    if (!ids.has(id)) return [];
    const from = el.getBoundingClientRect();
    const ghost = el.cloneNode(true) as HTMLElement;
    Object.assign(ghost.style, {
      position: "fixed",
      left: `${from.left}px`,
      top: `${from.top}px`,
      width: `${from.width}px`,
      height: `${from.height}px`,
      margin: "0",
      zIndex: "50",
      pointerEvents: "none",
      transform: "none",
    });
    return [{ id, ghost, from }];
  });
  flushSync(clear);
  const timing = { duration: 250, easing: EASING };
  for (const el of lists.flatMap(rowsIn)) {
    const was = before.get(el.dataset.rowId);
    if (!was || ids.has(el.dataset.rowId ?? "")) continue;
    const dy = was.top - el.getBoundingClientRect().top;
    if (Math.abs(dy) < 1) continue;
    el.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], timing);
  }
  const home = rowsIn(incoming.from);
  for (const { id, ghost, from } of ghosts) {
    const row = home.find((el) => el.dataset.rowId === id);
    // Folded away or filtered out in its own list: nowhere to land.
    if (!row) continue;
    const to = row.getBoundingClientRect();
    document.body.append(ghost);
    row.style.visibility = "hidden";
    void ghost
      .animate(
        [
          { transform: "none", opacity: 0.5 },
          {
            transform: `translate(${to.left - from.left}px, ${to.top - from.top}px)`,
            opacity: 1,
          },
        ],
        timing,
      )
      .finished.finally(() => {
        ghost.remove();
        row.style.visibility = "";
      });
  }
}

export const MOUSE = { activationConstraint: { distance: 5 } };
export const TOUCH = { activationConstraint: { delay: 200, tolerance: 5 } };

/**
 * The board's drag and drop, and its moves between lists: one drag context
 * for every list's rows, so a row can be dragged out of its list and into
 * another, where it makes room for it. Each list still decides its own
 * drags (reordering and nesting, DraggableItemList); a drop in another list
 * opens the move's confirmation (MoveItemDialog), with the row waiting there,
 * faded, until it's confirmed or cancelled. With no `groups` (one list, or
 * the landing page's preview) rows stay in their lists and nothing moves.
 */
export function BoardDrag({
  groups,
  children,
}: {
  /** The lists an item can move to, on their trays (MoveTargets). */
  groups: MoveTargets["groups"] | null;
  children: ReactNode;
}) {
  const [lists] = useState(() => new Map<string, ListDrag>());
  const [incoming, setIncomingState] = useState<Incoming | null>(null);
  const latest = useRef<Incoming | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [request, setRequest] = useState<MoveRequest | null>(null);

  const setIncoming = useCallback((next: Incoming | null) => {
    latest.current = next;
    setIncomingState(next);
  }, []);
  const canMoveTo = (id: string) =>
    groups?.some((g) => g.lists.some((l) => l.id === id)) ?? false;

  // The rows of the list under the pointer: the dragged row's own, or
  // another it can move to. Between lists, none. From the keyboard, which
  // has no pointer, only its own list's.
  const collide: CollisionDetection = (args) => {
    const home = homeOf(args.active) ?? "";
    let list: string | null = home;
    if (args.pointerCoordinates && canMoveTo(home)) {
      list = columnAt(args.pointerCoordinates);
      if (list !== home && list && !canMoveTo(list)) list = null;
    }
    if (!list) return [];
    const there = args.droppableContainers.filter(
      (c) => c.data.current?.projectId === list,
    );
    const rows = there.filter((c) => c.data.current?.row);
    if (rows.length > 0) return closestRow({ ...args, droppableContainers: rows });
    // An empty list: the list itself.
    return there.map((c) => ({ id: c.id, data: { droppableContainer: c, value: 0 } }));
  };

  // The sensors' options are built once: new ones would give every row new
  // drag listeners on each render, and re-render all of them.
  const [keyboard] = useState(() => ({
    coordinateGetter: ((event, args) =>
      lists.get(homeOf(args.context.active) ?? "")?.coordinateGetter(event, args)) as KeyboardCoordinateGetter,
  }));
  const sensors = useSensors(
    useSensor(MouseSensor, MOUSE),
    useSensor(TouchSensor, TOUCH),
    useSensor(KeyboardSensor, keyboard),
  );
  const answer = (active: Active) => lists.get(homeOf(active) ?? "")?.announcements;
  const announcements: Announcements = {
    onDragStart: (a) => answer(a.active)?.onDragStart(a),
    onDragMove: (a) => answer(a.active)?.onDragMove?.(a),
    onDragOver: (a) => answer(a.active)?.onDragOver(a),
    onDragEnd: (a) => answer(a.active)?.onDragEnd(a),
    onDragCancel: (a) => answer(a.active)?.onDragCancel(a),
  };

  // Both contexts keep their value while what they say is the same: every
  // list reads them, so a new one each render would re-render every list on
  // the board for a change to one of them.
  const move = useMemo<MoveTargets | null>(
    () =>
      groups && {
        groups,
        open: (item, projectId, position) => setRequest({ item, projectId, position }),
      },
    [groups],
  );
  const drag = useMemo<BoardDragValue>(
    () => ({
      incoming,
      getIncoming: () => latest.current,
      setIncoming,
      register: (projectId, list) => {
        lists.set(projectId, list);
        return () => {
          if (lists.get(projectId) === list) lists.delete(projectId);
        };
      },
      source,
    }),
    [incoming, setIncoming, lists, source],
  );
  function close(moved?: boolean) {
    setRequest(null);
    // Only the row dropped for this move: another may still be waiting for
    // the refresh of one already made.
    const now = latest.current;
    const dropped =
      now?.dropped && now.item.id === request?.item.id && now.to === request.projectId
        ? now
        : null;
    // Moved: it waits there until the refresh that brings the real row
    // (DraggableItemList).
    if (!dropped || moved) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setIncoming(null);
    } else {
      glideBack(dropped, () => setIncoming(null));
    }
  }

  return (
    <MoveItemContext value={move}>
      <BoardDragContext value={drag}>
        <DndContext
          // Stable, unique id so dnd-kit's aria-describedby is deterministic
          // across SSR and client. Without it, dnd-kit falls back to a global
          // counter that diverges between server and client and warns on hydration.
          id="board-items"
          sensors={sensors}
          collisionDetection={collide}
          // A dragged parent's sub-items leave the list, and rows come and go
          // between lists, so re-measure the rows as they change mid-drag.
          // Only while dragging: Always also measures every row as it mounts,
          // a forced layout per row on each view switch.
          measuring={{ droppable: { strategy: MeasuringStrategy.WhileDragging } }}
          accessibility={{
            announcements,
            screenReaderInstructions: {
              draggable:
                "To move an item, press Space. Use the up and down arrows to move it, right to make it a sub-item of the task above and left to move it out of a checklist. Press Space to drop it, or Escape to cancel.",
            },
          }}
          // A dragged list scrolls the board itself (ListDragging): dnd-kit's
          // scrolling follows the list's slot, which moves as it's dragged.
          autoScroll={source !== LIST_SOURCE}
          onDragStart={({ active }) => setSource(homeOf(active) ?? null)}
        >
          {children}
        </DndContext>
      </BoardDragContext>
      {move && <MoveItemDialog request={request} onClose={close} />}
    </MoveItemContext>
  );
}
