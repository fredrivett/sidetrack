"use client";

import {
  type Active,
  type Announcements,
  type DragEndEvent,
  type DragMoveEvent,
  DragOverlay,
  type DropAnimation,
  type DroppableContainer,
  defaultDropAnimationSideEffects,
  type KeyboardCoordinateGetter,
  type Modifier,
  type Over,
  type UniqueIdentifier,
  useDndMonitor,
  useDroppable,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  type SortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS, getEventCoordinates } from "@dnd-kit/utilities";
import { Plus } from "lucide-react";
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import type { AssigneeView } from "@/core/members";
import type { Item, ItemPrLink } from "@/core/schema";
import { type DropTarget, nestItems, projectDrop, type TreeRow } from "@/lib/itemTree";
import { columnEl, useBoardDrag } from "./BoardDrag";
import { useItemSaves } from "./item-saves";
import { ItemRow, type RowDrag } from "./ItemRow";
import { useMoveItem } from "./MoveItem";
import { Button } from "./ui/button";
import { runAction } from "./run-action";
import { useCollapsedItems } from "./use-collapsed-items";

/** A top-level item with its sub-items, in list order. */
export type ItemGroup = Item & { children: Item[] };

export type RowProps = {
  prefix: string;
  assignees: AssigneeView[];
  viewerId: string;
  prLinksByItem: Record<string, ItemPrLink[]>;
  onOpenDetail: (item: Item) => void;
};

// How far a sub-item sits in from its parent (ml-4 + pl-5), which is also how
// far sideways a row is dragged to nest or un-nest it.
const INDENT = 36;

// A tree line from the parent's checkbox down to each sub-item, bending into
// it at its first line: an elbow from the gap above into the row, plus, for
// every sub-item but the last, the line carrying on down to the next one.
// Row maths: the gap between rows is 6px (space-y-1.5), and a row's first line
// is centred 19px into it (1px border + 8px padding + half a 20px line).
const BRANCH =
  "relative before:absolute before:-top-1.5 before:-left-5 before:h-[25px] before:w-5 before:rounded-bl-lg before:border-b-2 before:border-l-2 before:border-neutral-200 dark:before:border-neutral-700";
const TRUNK =
  "after:absolute after:top-0 after:-bottom-1.5 after:-left-5 after:border-l-2 after:border-neutral-200 dark:after:border-neutral-700";

function rowFor(
  row: RowProps,
  item: Item,
  extra: Partial<Parameters<typeof ItemRow>[0]> = {},
) {
  return (
    <ItemRow
      item={item}
      prefix={row.prefix}
      assignees={row.assignees}
      viewerId={row.viewerId}
      prLinks={row.prLinksByItem[item.id] ?? []}
      onOpenDetail={() => row.onOpenDetail(item)}
      {...extra}
    />
  );
}

// The margin puts the tree line under the parent's checkbox; pl-5 leaves room
// for each branch to bend into its row. (DraggableItemList draws the same, inline.)
function SubItem({ last, children }: { last: boolean; children: ReactNode }) {
  return (
    <div className="ml-4 pl-5">
      <div className={last ? BRANCH : `${BRANCH} ${TRUNK}`}>{children}</div>
    </div>
  );
}

// On drop the card glides into its slot and settles back down (the
// `dnd-dropping` class undoes its lift), while the slot's real row stays hidden
// under it until it lands (`dnd-landing`). Only the row's card hides, so its
// tree line stays put, and by visibility, not dnd-kit's default opacity, which
// the rows' fade would turn into a blink.
const dropAnimation: DropAnimation = {
  duration: 200,
  easing: "cubic-bezier(0.25, 1, 0.5, 1)",
  sideEffects: defaultDropAnimationSideEffects({
    className: { active: "dnd-landing", dragOverlay: "dnd-dropping" },
  }),
};

const progress = (children: Item[]) => ({
  done: children.filter((c) => c.completedAt !== null).length,
  total: children.length,
});

/**
 * A top-level row followed by its sub-items, indented and static: Done,
 * No date, and the copy of a dragged parent that follows the pointer. The
 * sub-items fold away as stored on the item, the same as on the board.
 */
export function ItemGroupView({
  group,
  collapsed: given,
  shown,
  list,
  ...row
}: RowProps & {
  group: ItemGroup;
  /** The list the item is on, shown on its row where lists mix (the Brief's dated sections). */
  list?: Parameters<typeof ItemRow>[0]["list"];
  /** Shown as given rather than as stored, as the drag overlay copies its list. */
  collapsed?: boolean;
  /**
   * The sub-items to show, when the viewer's filters hide some; the
   * checklist's count still covers them all.
   */
  shown?: ReadonlySet<string>;
}) {
  const { collapsed, setCollapsed } = useCollapsedItems([group]);
  const expanded = !(given ?? collapsed.has(group.id));
  const all = group.children;
  const children = shown ? all.filter((c) => shown.has(c.id)) : all;
  return (
    <div className="space-y-1.5">
      {rowFor(row, group, {
        list,
        checklist:
          all.length > 0
            ? {
                ...progress(all),
                expanded,
                onToggle: () => setCollapsed([group.id], expanded),
              }
            : undefined,
      })}
      {expanded &&
        children.map((child, i) => (
          <SubItem key={child.id} last={i === children.length - 1}>
            {rowFor(row, child, { parentTitle: group.title })}
          </SubItem>
        ))}
    </div>
  );
}

/** A row of the list in the order shown, with the parent it shows under. */
type Flat = { item: Item; parentId: string | null };

const flatten = (groups: ItemGroup[]): Flat[] =>
  groups.flatMap(({ children, ...g }) => [
    { item: g, parentId: null },
    ...children.map((c) => ({ item: c, parentId: g.id })),
  ]);

/** The order after a drop: the item (and a parent's checklist) at `target`. */
function applyDrop(
  full: Flat[],
  id: string,
  target: Pick<DropTarget, "parentId" | "position">,
): Flat[] {
  const block = full
    .filter((f) => f.item.id === id || f.parentId === id)
    .map((f) => (f.item.id === id ? { ...f, parentId: target.parentId } : f));
  const rest = full.filter((f) => f.item.id !== id && f.parentId !== id);
  let at = 0;
  if (target.position === "top") {
    if (target.parentId) {
      at = rest.findIndex((f) => f.item.id === target.parentId) + 1;
    }
  } else if (target.position.startsWith("before:")) {
    const anchor = target.position.slice("before:".length);
    at = rest.findIndex((f) => f.item.id === anchor);
  } else {
    // After the anchor and its checklist, if it has one ("end" anchors on the
    // parent, landing after its last sub-item).
    const anchor =
      target.position === "end"
        ? target.parentId
        : target.position.slice("after:".length);
    at = rest.findIndex((f) => f.item.id === anchor) + 1;
    while (at < rest.length && rest[at].parentId === anchor) at++;
  }
  return [...rest.slice(0, at), ...block, ...rest.slice(at)];
}

/**
 * A drop applied to a flat, position-ordered list of items, as the server
 * applies it (reorderItem, setItemParent): for the landing page's preview
 * board, which keeps its items locally. Nesting an open item reopens a
 * finished parent.
 */
export function moveItem(
  list: Item[],
  id: string,
  target: Pick<DropTarget, "parentId" | "position">,
): Item[] {
  const moved = list.find((i) => i.id === id);
  const reopens =
    target.parentId !== null &&
    moved?.parentId !== target.parentId &&
    moved?.completedAt === null;
  return applyDrop(flatten(nestItems(list)), id, target).map((f) => ({
    ...f.item,
    parentId: f.parentId,
    ...(reopens && f.item.id === target.parentId && { completedAt: null }),
  }));
}

function Sortable({
  id,
  data,
  dim,
  pending,
  children,
}: {
  id: string;
  /** Where it's shown and whose it is (see BoardDrag). */
  data: { projectId: string; home: string; row: true; parentId: string | null };
  /** Another row of its list is being dragged. */
  dim: boolean;
  /** Dropped here from another list, waiting for its move. */
  pending: boolean;
  children: (drag: RowDrag) => ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, data, disabled: pending });
  return (
    <div
      ref={setNodeRef}
      data-row-id={id}
      aria-disabled={pending || undefined}
      className={pending ? "pointer-events-none" : undefined}
      style={{
        // Translate, not Transform: rows differ in height, and a scale would
        // stretch one into its neighbour's size.
        transform: CSS.Translate.toString(transform),
        // The other rows fade back while one is dragged, so the card in hand
        // and the slot it would drop into stand out. A row waiting for its
        // move stays faded until it lands, then fades in.
        transition: [transition, "opacity 200ms ease"].filter(Boolean).join(", "),
        opacity: pending || (dim && !isDragging) ? 0.5 : 1,
      }}
    >
      {children({ attributes, listeners, setActivatorNodeRef, isDragging })}
    </div>
  );
}

// A row from another list is placed where it's dragged (Incoming.position),
// so the list mustn't shift its rows again to sort it.
const placed: SortingStrategy = () => null;

/**
 * The open list as one sortable tree: top-level items with their sub-items
 * under them. Dragging a row up or down moves it; dragging it sideways by an
 * indent nests it in the checklist it's dropped in or moves it out to the top
 * level (see `projectDrop` for what each spot allows). A parent drags with its
 * checklist. From the keyboard: Space picks up a focused row, the arrows move
 * and indent it, and Space drops it.
 *
 * Dragged out of its column and into another list, a row leaves this one
 * and that list makes room for it among its top-level items. Dropped there,
 * it waits, faded, while the move is confirmed (BoardDrag); it stays put
 * until then. Mouse and touch only: from the keyboard, it's the row menu's
 * Move to list.
 *
 * With the viewer's filters on, only the `shown` rows are in the list. A drop
 * lands among those: just after the row on view above it (ahead of any hidden
 * ones that follow), or just before the one below it, so hidden items keep
 * their places around it. The tree stays the real one, so a sub-item
 * always drags in its own checklist, and a row with hidden sub-items still
 * counts them, and still can't become a sub-item itself.
 */
export function DraggableItemList({
  projectId,
  groups,
  shown,
  collapsed,
  onToggleCollapsed,
  onAddItem,
  ...row
}: RowProps & {
  projectId: string;
  groups: ItemGroup[];
  /** The rows the viewer's filters leave; all when omitted. */
  shown?: ReadonlySet<string>;
  /** Parents whose sub-items are hidden. */
  collapsed: ReadonlySet<string>;
  onToggleCollapsed: (id: string) => void;
  /** Opens New item for this list, from the empty state. */
  onAddItem: () => void;
}) {
  // The order just dropped, shown until the server's refresh lands: held for
  // the whole transition, so the list can't flash back to the old order
  // between the action returning and the new order rendering.
  const [full, setFull] = useOptimistic(flatten(groups));
  const [, start] = useTransition();
  const saves = useItemSaves();
  const board = useBoardDrag();
  const move = useMoveItem();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [offsetX, setOffsetX] = useState(0);
  // Its row is over another list, or between lists.
  const [away, setAway] = useState(false);

  // A row from another list on its way in, and one of this list's on its
  // way out, which is gone from here meanwhile.
  const { incoming } = board;
  const entering =
    incoming?.to === projectId && incoming.from !== projectId ? incoming : null;
  const leaving =
    incoming?.from === projectId && incoming.to !== projectId ? incoming.item.id : null;
  const enteringIds = new Set(
    entering ? [entering.item.id, ...entering.children.map((c) => c.id)] : [],
  );
  const own = new Map(full.map((f) => [f.item.id, f]));
  const ownChildren = (id: string) =>
    full.filter((f) => f.parentId === id).map((f) => f.item);
  const rows: Flat[] = entering
    ? applyDrop(
        [
          ...full.filter((f) => !enteringIds.has(f.item.id)),
          { item: entering.item, parentId: null },
          ...entering.children.map((c) => ({ item: c, parentId: entering.item.id })),
        ],
        entering.item.id,
        { parentId: null, position: entering.position },
      )
    : leaving
      ? full.filter((f) => f.item.id !== leaving && f.parentId !== leaving)
      : full;

  // Indexed once per render: a drag re-renders on every pointer move.
  const kids = new Map<string, Item[]>();
  for (const f of rows) {
    if (!f.parentId) continue;
    const siblings = kids.get(f.parentId);
    if (siblings) siblings.push(f.item);
    else kids.set(f.parentId, [f.item]);
  }
  const childrenOf = (id: string) => kids.get(id) ?? [];
  const byId = new Map([...own, ...rows.map((f) => [f.item.id, f] as const)]);

  // Rows as shown. A dragged parent's sub-items travel with it, so they leave
  // the list while it's dragged, here or into another list.
  const carried = activeId ?? (entering && !entering.dropped ? entering.item.id : null);
  const folded = (id: string) =>
    enteringIds.has(id) ? entering?.collapsed : collapsed.has(id);
  const visible = rows.filter(
    (f) =>
      (enteringIds.has(f.item.id) || !shown || shown.has(f.item.id)) &&
      (f.parentId === null || (!folded(f.parentId) && f.parentId !== carried)),
  );
  const treeRows: TreeRow[] = visible.map((f) => ({
    id: f.item.id,
    depth: f.parentId ? 1 : 0,
    parentId: f.parentId,
    hasChildren: kids.has(f.item.id),
    collapsed: collapsed.has(f.item.id),
  }));
  const project = (active: string, over: string, dx: number) =>
    projectDrop(treeRows, active, over, Math.round(dx / INDENT));
  const projection =
    activeId && overId && !away ? project(activeId, overId, offsetX) : null;

  // The keyboard sensor and the screen-reader announcements read the drag as
  // it is now: dnd-kit announces a move in the same tick as onDragMove, before
  // this re-renders with the new offset.
  const live = useRef({
    offsetX: 0,
    away: false,
    projection,
    activeDepth: 0,
    project,
    spot: null as string | null,
    // The pointer's y during a drag, from its own listener: dnd-kit's rects
    // for the dragged row are off once it's shown in another list.
    pointerY: null as number | null,
    // A row of this list is being dragged: from its start until it's
    // dropped or cancelled.
    dragging: false,
  });
  useLayoutEffect(() => {
    live.current.projection = projection;
    live.current.project = project;
  });

  const coordinateGetter: KeyboardCoordinateGetter = (event, args) => {
    const { currentCoordinates: at } = args;
    if (event.code === "ArrowRight" || event.code === "ArrowLeft") {
      event.preventDefault();
      const p = live.current.projection;
      const depth = (p?.depth ?? 0) + (event.code === "ArrowRight" ? 1 : -1);
      if (!p || depth < p.minDepth || depth > p.maxDepth) return undefined;
      // Set the sideways offset to exactly that depth.
      return {
        x: at.x - live.current.offsetX + (depth - live.current.activeDepth) * INDENT,
        y: at.y,
      };
    }
    // Up and down move between rows of this list (the board's other lists
    // aren't reachable from the keyboard); keep the sideways offset as it
    // was, so the depth picked carries over to the new spot.
    const all = args.context.droppableContainers;
    const Rows = all.constructor as new (
      entries: Iterable<[UniqueIdentifier, DroppableContainer]>,
    ) => typeof all;
    const next = sortableKeyboardCoordinates(event, {
      ...args,
      context: {
        ...args.context,
        droppableContainers: new Rows(
          [...all].filter(
            ([, c]) => c.data.current?.projectId === projectId && c.data.current?.row,
          ),
        ),
      },
    });
    return next && { x: at.x, y: next.y };
  };

  const title = (id: UniqueIdentifier) => byId.get(String(id))?.item.title ?? "item";
  const listName = (id: string) =>
    move?.groups.flatMap((g) => g.lists).find((l) => l.id === id)?.name ?? "another list";
  function describe(active: UniqueIdentifier, over: Over | null) {
    const to = over?.data.current?.projectId as string | undefined;
    if (to && to !== projectId) return `“${title(active)}” would move to ${listName(to)}.`;
    const p = over
      ? live.current.project(String(active), String(over.id), live.current.offsetX)
      : null;
    if (!p) return `“${title(active)}” can't go here.`;
    if (!p.parentId) return `“${title(active)}” is at the top level.`;
    return `“${title(active)}” is in “${title(p.parentId)}”’s checklist.`;
  }
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up “${title(active.id)}”.`,
    onDragMove: ({ active, over }) => describe(active.id, over),
    onDragOver: ({ active, over }) => describe(active.id, over),
    onDragEnd: ({ active, over }) => `Dropped. ${describe(active.id, over)}`,
    onDragCancel: ({ active }) => `Put “${title(active.id)}” back.`,
  };
  useLayoutEffect(() => board.register(projectId, { coordinateGetter, announcements }));

  // A light tick each time the drag moves the drop spot to somewhere new (a
  // slot up or down, or nesting and un-nesting), like a native list reorder.
  // Spots it can't land on stay silent. Android only: iOS plays web haptics
  // only for a tap on a switch, never during a drag, and has no vibrate.
  function tickOnNewSpot(active: UniqueIdentifier, over: UniqueIdentifier | undefined, dx: number) {
    const p = over ? project(String(active), String(over), dx) : null;
    if (!p) return;
    const spot = `${p.parentId}|${p.position}`;
    if (spot === live.current.spot) return;
    live.current.spot = spot;
    navigator.vibrate?.(8);
  }

  // Where among another list's top-level items the row would land: before
  // or after the row it's over, by which half it's in. Over a sub-item,
  // after its checklist; over an empty list, in it. Over its own slot there,
  // where it already is.
  function spotIn(active: Active, over: Over): string | null {
    if (over.id === active.id) return board.getIncoming()?.position ?? null;
    const d = over.data.current;
    if (!d?.row) return "end";
    if (d.parentId) return `after:${d.parentId}`;
    const y = live.current.pointerY ?? 0;
    return y > over.rect.top + over.rect.height / 2
      ? `after:${over.id}`
      : `before:${over.id}`;
  }

  // Follows its row as it's dragged: over its own list, or away, maybe
  // into another one, which then makes room for it.
  function follow(active: Active, over: Over | null, dx: number) {
    const to = over?.data.current?.projectId as string | undefined;
    const isAway = to !== projectId;
    live.current.offsetX = dx;
    setOffsetX(dx);
    if (isAway !== live.current.away) {
      live.current.away = isAway;
      setAway(isAway);
    }
    const id = String(active.id);
    const position = to && isAway && over ? spotIn(active, over) : null;
    const now = board.getIncoming();
    if (!to || !position) {
      if (now && !now.dropped) board.setIncoming(null);
    } else if (now?.to !== to || now.position !== position) {
      const f = own.get(id);
      if (!f) return;
      board.setIncoming({
        item: f.item,
        children: ownChildren(id),
        from: projectId,
        to,
        position,
        dropped: false,
        collapsed: collapsed.has(id),
        row,
      });
      navigator.vibrate?.(8);
    }
    if (!isAway) tickOnNewSpot(active.id, over?.id, live.current.offsetX);
  }

  function reset() {
    setActiveId(null);
    setOverId(null);
    setOffsetX(0);
    setAway(false);
    live.current.away = false;
    live.current.dragging = false;
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    const id = String(active.id);
    if (live.current.away) {
      reset();
      const now = board.getIncoming();
      if (now && !now.dropped && now.from === projectId && move) {
        // It waits there, faded, for the move's confirmation (BoardDrag).
        board.setIncoming({ ...now, dropped: true });
        navigator.vibrate?.(15);
        move.open(now.item, now.to, now.position);
      } else {
        board.setIncoming(null);
      }
      return;
    }
    let target = over ? project(id, String(over.id), live.current.offsetX) : null;
    reset();
    // First among the rows on view isn't first in the list when the filters
    // hide some above it: land just before the sibling on view below instead.
    if (shown && target?.position === "top") {
      const below = visible.find(
        (f) => f.item.id !== id && f.parentId !== id && f.parentId === target?.parentId,
      );
      if (below) target = { ...target, position: `before:${below.item.id}` };
    }
    const from = own.get(id);
    if (!over || !target || !from) return;
    const sameParent = target.parentId === from.parentId;
    // Dropped where it started.
    if (sameParent && over.id === active.id) return;

    // A firmer tap as it lands somewhere new.
    navigator.vibrate?.(15);
    start(async () => {
      setFull(applyDrop(full, id, target));
      await runAction(
        sameParent
          ? saves.reorderItem(id, target.position)
          : saves.setItemParent(id, target.parentId, target.position),
        `move “${from.item.title}”`,
      );
    });
  }

  // Only drags of this list's own rows, wherever they're shown.
  const mine = (active: Active) => active.data.current?.home === projectId;
  // dnd-kit can report one last move after the drop, as on iOS when the
  // board scrolls under the finger: following it would take the row away
  // again and leave the board unsnapped.
  const following = (active: Active) => mine(active) && live.current.dragging;
  useDndMonitor({
    onDragStart({ active, activatorEvent }) {
      if (!mine(active)) return;
      live.current.dragging = true;
      live.current.pointerY = getEventCoordinates(activatorEvent)?.y ?? null;
      const id = String(active.id);
      setActiveId(id);
      setOverId(id);
      live.current.offsetX = 0;
      live.current.activeDepth = own.get(id)?.parentId ? 1 : 0;
      // Where it sits now, among the rows as the drag shows them: without
      // a parent's sub-items, which leave the list on this re-render.
      const home = projectDrop(
        treeRows.filter((r) => r.parentId !== id),
        id,
        id,
        0,
      );
      live.current.spot = home && `${home.parentId}|${home.position}`;
      // A tick under the finger when a long-press picks the row up
      // (where the browser supports it; Safari doesn't).
      if (!(activatorEvent instanceof KeyboardEvent)) navigator.vibrate?.(10);
    },
    onDragMove({ active, over, delta }: DragMoveEvent) {
      if (following(active)) follow(active, over, delta.x);
    },
    onDragOver({ active, over, delta }) {
      if (!following(active)) return;
      setOverId(over ? String(over.id) : null);
      follow(active, over, delta.x);
    },
    onDragEnd(event) {
      if (mine(event.active)) onDragEnd(event);
    },
    onDragCancel({ active }) {
      if (!mine(active)) return;
      reset();
      board.setIncoming(null);
    },
  });

  // Follow the pointer while a row of this list is dragged, ahead of
  // dnd-kit's own listeners (capture), so its events read where it is now.
  const dragging = activeId !== null && move !== null;
  useEffect(() => {
    if (!dragging) return;
    const follow = (e: PointerEvent | TouchEvent) => {
      live.current.pointerY = getEventCoordinates(e)?.y ?? live.current.pointerY;
    };
    window.addEventListener("pointermove", follow, true);
    window.addEventListener("touchmove", follow, true);
    return () => {
      window.removeEventListener("pointermove", follow, true);
      window.removeEventListener("touchmove", follow, true);
    };
  }, [dragging]);

  // Away from its column, the board stops snapping to columns, so it can
  // scroll smoothly under the card.
  useEffect(() => {
    if (!away) return;
    const rail = columnEl(projectId)?.closest<HTMLElement>(".kanban-rail");
    if (!rail) return;
    rail.style.scrollSnapType = "none";
    return () => {
      rail.style.scrollSnapType = "";
    };
  }, [away, projectId]);
  // Moved: once the refresh has taken it out of this list, the list it went
  // to has the real row, which takes the waiting one's place and fades in.
  const gone = leaving !== null && incoming?.dropped === true && !own.has(leaving);
  useEffect(() => {
    if (gone) board.setIncoming(null);
  }, [gone, board]);
  // A row from another list over this one lights it up.
  const lit = entering !== null && !entering.dropped;
  useEffect(() => {
    const el = lit ? columnEl(projectId) : undefined;
    if (!el) return;
    el.dataset.dropTarget = "";
    return () => {
      delete el.dataset.dropTarget;
    };
  }, [lit, projectId]);

  // The list itself takes a row from another list when it has none.
  const { setNodeRef: setListRef } = useDroppable({
    id: `list:${projectId}`,
    data: { projectId },
  });

  const active = activeId ? own.get(activeId) : undefined;
  // How far in the dragged card sits: the depth it would land at, or its own
  // where it can't land; flush away from its list.
  const shift = away ? 0 : (projection?.depth ?? (active?.parentId ? 1 : 0)) * INDENT;
  // The card moves only up and down in its list; sideways it snaps to the
  // depth it would land at, rather than sliding freely. Away from its list it
  // follows the pointer.
  const lockX: Modifier = ({ transform }) => (away ? transform : { ...transform, x: 0 });
  // What follows the pointer: the row, with a parent's checklist, lifted off
  // the list (scaled up with a deep shadow) until it's dropped. Drawn by the
  // list it's from, wherever it goes, even once that list is empty without it.
  const overlay = board.source === projectId && (
    <DragOverlay modifiers={[lockX]} dropAnimation={dropAnimation}>
      {active && (
        // Full width, like the row's sortable node, with the card indented
        // inside: the drop glides this box onto that node, so an indented
        // card lands indented instead of sliding out to the left.
        <div
          className="transition-[padding] duration-200 ease-out"
          style={{ paddingLeft: shift }}
        >
          <div
            // The column's own background, so rows under a parent's checklist
            // don't show through the gaps between its rows.
            // Grabbing over everything in it, overriding the row's pointer.
            className="cursor-grabbing rounded-lg **:cursor-grabbing! bg-white shadow-xl transition-[scale,box-shadow] duration-200 ease-out in-[.dnd-dropping]:scale-100! in-[.dnd-dropping]:shadow-none motion-safe:scale-[1.03] motion-safe:animate-[lift_150ms_ease-out] dark:bg-neutral-900"
          >
            {active.parentId ? (
              rowFor(row, active.item)
            ) : (
              <ItemGroupView
                {...row}
                group={{ ...active.item, children: ownChildren(active.item.id) }}
                collapsed={collapsed.has(active.item.id)}
                shown={shown}
              />
            )}
          </div>
        </div>
      )}
    </DragOverlay>
  );

  if (rows.length === 0) {
    return (
      <>
        {/* The whole card is a pointer target, like the board's Add list column;
            the button inside is the keyboard one, and its click bubbles up here. */}
        <div
          ref={setListRef}
          onClick={onAddItem}
          className="group/add-item flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-neutral-200 bg-neutral-50 px-3 py-8 text-center text-xs text-balance text-neutral-500 transition-colors hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-800/30 dark:text-neutral-400 dark:hover:border-neutral-700"
        >
          <p>Nothing to do yet.</p>
          <Button
            variant="outline"
            size="xs"
            // Dark like an item row, so it sits below the card, not on it, and in
            // its hover state while the card is hovered.
            className="dark:bg-neutral-900 group-hover/add-item:bg-muted group-hover/add-item:text-foreground dark:group-hover/add-item:bg-neutral-800"
          >
            <Plus />
            Add item
          </Button>
        </div>
        {overlay}
      </>
    );
  }
  if (visible.length === 0 && !activeId) {
    return (
      <>
        <p
          ref={setListRef}
          className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50 px-3 py-4 text-center text-xs text-balance text-neutral-500 dark:border-neutral-800 dark:bg-neutral-800/30 dark:text-neutral-400"
        >
          Nothing here for your filters.
        </p>
        {overlay}
      </>
    );
  }

  // The top-level task above each top-level row, for the row menu's "Sub-item of".
  const above = new Map<string, Item>();
  let prevTop: Item | undefined;
  for (const f of visible) {
    if (f.parentId) continue;
    if (prevTop) above.set(f.item.id, prevTop);
    prevTop = f.item;
  }

  // Each sub-item's tree line, from the rows in the order they're shown:
  // mid-drag, the dragged row's slot sits where it would land, under the
  // parent it would land in, and the rows around it shift to make room. So
  // the lines run through the slot, and are already right when it lands.
  const activeAt = activeId && !away ? visible.findIndex((f) => f.item.id === activeId) : -1;
  const overAt = overId ? visible.findIndex((f) => f.item.id === overId) : -1;
  const shownRows = (
    activeAt !== -1 && overAt !== -1 ? arrayMove(visible, activeAt, overAt) : visible
  ).map((f) => ({
    id: f.item.id,
    parentId: f.item.id === activeId && projection ? projection.parentId : f.parentId,
  }));
  const treeLines = new Map(
    shownRows.map((r, i) => [
      r.id,
      !r.parentId
        ? undefined
        : shownRows[i + 1]?.parentId === r.parentId
          ? `${BRANCH} ${TRUNK}`
          : BRANCH,
    ]),
  );

  // The overlay sits in the same place in every branch, so it stays mounted
  // (and keeps its drop animation) when the list empties mid-drag.
  return (
    <>
      <div ref={setListRef}>
        <SortableContext
          items={visible.map((f) => f.item.id)}
          strategy={entering ? placed : verticalListSortingStrategy}
        >
          <div className="space-y-1.5">
            {visible.map((f) => {
              const { item } = f;
              const isActive = item.id === activeId;
              const isEntering = enteringIds.has(item.id);
              // A row from another list shows its own ref and people.
              const rp = isEntering && entering ? entering.row : row;
              const children = childrenOf(item.id);
              const node = (drag: RowDrag) => {
                if (f.parentId) {
                  return rowFor(rp, item, {
                    drag,
                    parentTitle: byId.get(f.parentId)?.item.title,
                  });
                }
                // A plain task can become a sub-item of the task just above it.
                const prev = above.get(item.id);
                const canNest = children.length === 0 && prev !== undefined && !isEntering;
                return rowFor(rp, item, {
                  drag,
                  nestUnder: canNest ? { id: prev.id, title: prev.title } : undefined,
                  checklist:
                    children.length > 0
                      ? {
                          ...progress(children),
                          expanded: !folded(item.id),
                          onToggle: () => onToggleCollapsed(item.id),
                        }
                      : undefined,
                });
              };
              return (
                <Sortable
                  key={item.id}
                  id={item.id}
                  data={{
                    projectId,
                    home: isEntering && entering ? entering.from : projectId,
                    row: true,
                    parentId: f.parentId,
                  }}
                  dim={activeId !== null && !away}
                  pending={isEntering && entering?.dropped === true}
                >
                  {(drag) => {
                    // The dragged row stays in the list as the drop placeholder,
                    // indented to the depth it would land at.
                    const depth = isActive
                      ? (projection?.depth ?? (f.parentId ? 1 : 0))
                      : f.parentId
                        ? 1
                        : 0;
                    // The same elements at every depth, so a row that's nested or
                    // moved out keeps its DOM node, and keyboard focus with it.
                    return (
                      <div className={depth ? "ml-4 pl-5" : undefined}>
                        <div
                          className={`in-[.dnd-landing]:*:invisible ${treeLines.get(item.id) ?? ""}`}
                        >
                          {node(drag)}
                        </div>
                      </div>
                    );
                  }}
                </Sortable>
              );
            })}
          </div>
        </SortableContext>
      </div>
      {overlay}
    </>
  );
}
