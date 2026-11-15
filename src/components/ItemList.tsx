"use client";

import {
  type Announcements,
  type CollisionDescriptor,
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  type DragMoveEvent,
  DragOverlay,
  type DropAnimation,
  defaultDropAnimationSideEffects,
  type KeyboardCoordinateGetter,
  KeyboardSensor,
  MeasuringStrategy,
  type Modifier,
  MouseSensor,
  TouchSensor,
  type UniqueIdentifier,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  type ReactNode,
  useLayoutEffect,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import { reorderItemAction, setItemParentAction } from "@/app/actions";
import type { AssigneeView } from "@/core/members";
import type { Item, ItemPrLink } from "@/core/schema";
import { type DropTarget, projectDrop, type TreeRow } from "@/lib/itemTree";
import { ItemRow, type RowDrag } from "./ItemRow";
import { runAction } from "./run-action";

/** A top-level item with its sub-items, in list order. */
export type ItemGroup = Item & { children: Item[] };

type RowProps = {
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
// for each branch to bend into its row. (ItemList draws the same, inline.)
function SubItem({ last, children }: { last: boolean; children: ReactNode }) {
  return (
    <div className="ml-4 pl-5">
      <div className={last ? BRANCH : `${BRANCH} ${TRUNK}`}>{children}</div>
    </div>
  );
}

// The dragged card moves only up and down; sideways it snaps to the depth it
// would land at (see the DragOverlay below), rather than sliding freely.
const lockX: Modifier = ({ transform }) => ({ ...transform, x: 0 });

// On drop the card glides into its slot and settles back down (the
// `dnd-dropping` class undoes its lift), while the slot's real row stays hidden
// under it until it lands. Hidden by visibility, not dnd-kit's default opacity,
// which the rows' fade would turn into a blink.
const dropAnimation: DropAnimation = {
  duration: 200,
  easing: "cubic-bezier(0.25, 1, 0.5, 1)",
  sideEffects: defaultDropAnimationSideEffects({
    styles: { active: { visibility: "hidden" } },
    className: { dragOverlay: "dnd-dropping" },
  }),
};

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

const progress = (children: Item[]) => ({
  done: children.filter((c) => c.completedAt !== null).length,
  total: children.length,
});

/**
 * A top-level row followed by its sub-items, indented and static: Done, and
 * the copy of a dragged parent that follows the pointer.
 */
export function ItemGroupView({
  group,
  defaultExpanded = true,
  ...row
}: RowProps & { group: ItemGroup; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const { children } = group;
  return (
    <div className="space-y-1.5">
      {rowFor(row, group, {
        checklist:
          children.length > 0
            ? {
                ...progress(children),
                expanded,
                onToggle: () => setExpanded((v) => !v),
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
function applyDrop(full: Flat[], id: string, target: DropTarget): Flat[] {
  const block = full
    .filter((f) => f.item.id === id || f.parentId === id)
    .map((f) => (f.item.id === id ? { ...f, parentId: target.parentId } : f));
  const rest = full.filter((f) => f.item.id !== id && f.parentId !== id);
  let at = 0;
  if (target.position === "top") {
    if (target.parentId) {
      at = rest.findIndex((f) => f.item.id === target.parentId) + 1;
    }
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

function Sortable({
  id,
  children,
}: {
  id: string;
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
    active,
  } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{
        // Translate, not Transform: rows differ in height, and a scale would
        // stretch one into its neighbour's size.
        transform: CSS.Translate.toString(transform),
        // The other rows fade back while one is dragged, so the card in hand
        // and the slot it would drop into stand out.
        transition: [transition, "opacity 200ms ease"].filter(Boolean).join(", "),
        opacity: active && !isDragging ? 0.5 : 1,
      }}
    >
      {children({ attributes, listeners, setActivatorNodeRef, isDragging })}
    </div>
  );
}

/**
 * The open list as one sortable tree: top-level items with their sub-items
 * under them. Dragging a row up or down moves it; dragging it sideways by an
 * indent nests it in the checklist it's dropped in or moves it out to the top
 * level (see `projectDrop` for what each spot allows). A parent drags with its
 * checklist. From the keyboard: Space picks up a focused row, the arrows move
 * and indent it, and Space drops it.
 */
export function ItemList({
  projectId,
  groups,
  collapsed,
  onToggleCollapsed,
  ...row
}: RowProps & {
  projectId: string;
  groups: ItemGroup[];
  /** Parents whose sub-items are hidden. */
  collapsed: ReadonlySet<string>;
  onToggleCollapsed: (id: string) => void;
}) {
  // The order just dropped, shown until the server's refresh lands: held for
  // the whole transition, so the list can't flash back to the old order
  // between the action returning and the new order rendering.
  const [full, setFull] = useOptimistic(flatten(groups));
  const [, start] = useTransition();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [offsetX, setOffsetX] = useState(0);

  // Indexed once per render: a drag re-renders on every pointer move.
  const kids = new Map<string, Item[]>();
  for (const f of full) {
    if (!f.parentId) continue;
    const siblings = kids.get(f.parentId);
    if (siblings) siblings.push(f.item);
    else kids.set(f.parentId, [f.item]);
  }
  const childrenOf = (id: string) => kids.get(id) ?? [];
  const byId = new Map(full.map((f) => [f.item.id, f]));

  // Rows as shown. A dragged parent's sub-items travel with it, so they leave
  // the list while it's dragged.
  const visible = full.filter(
    (f) =>
      f.parentId === null ||
      (!collapsed.has(f.parentId) && f.parentId !== activeId),
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
    activeId && overId ? project(activeId, overId, offsetX) : null;

  // The keyboard sensor and the screen-reader announcements read the drag as
  // it is now: dnd-kit announces a move in the same tick as onDragMove, before
  // this re-renders with the new offset.
  const live = useRef({
    offsetX: 0,
    projection,
    activeDepth: 0,
    project,
    spot: null as string | null,
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
    // Up and down move between rows; keep the sideways offset as it was, so
    // the depth picked carries over to the new spot.
    const next = sortableKeyboardCoordinates(event, args);
    return next && { x: at.x, y: next.y };
  };

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter }),
  );

  const title = (id: UniqueIdentifier) => byId.get(String(id))?.item.title ?? "item";
  function describe(active: UniqueIdentifier, over: UniqueIdentifier | undefined) {
    const p = over
      ? live.current.project(String(active), String(over), live.current.offsetX)
      : null;
    if (!p) return `“${title(active)}” can't go here.`;
    if (!p.parentId) return `“${title(active)}” is at the top level.`;
    return `“${title(active)}” is in “${title(p.parentId)}”’s checklist.`;
  }
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up “${title(active.id)}”.`,
    onDragMove: ({ active, over }) => describe(active.id, over?.id),
    onDragOver: ({ active, over }) => describe(active.id, over?.id),
    onDragEnd: ({ active, over }) =>
      `Dropped. ${describe(active.id, over?.id)}`,
    onDragCancel: ({ active }) => `Put “${title(active.id)}” back.`,
  };

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

  function reset() {
    setActiveId(null);
    setOverId(null);
    setOffsetX(0);
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    const id = String(active.id);
    const target = over ? project(id, String(over.id), offsetX) : null;
    reset();
    const from = byId.get(id);
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
          ? reorderItemAction(id, target.position)
          : setItemParentAction(id, target.parentId, target.position),
        `move “${from.item.title}”`,
      );
    });
  }

  if (groups.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50 px-3 py-4 text-center text-xs text-balance text-neutral-500 dark:border-neutral-800 dark:bg-neutral-800/30 dark:text-neutral-400">
        Nothing to do — add an item from the list’s ⋯ menu.
      </p>
    );
  }

  const active = activeId ? byId.get(activeId) : undefined;
  // How far in the dragged card sits: the depth it would land at, or its own
  // where it can't land. (Each row's sortable node spans the full width.)
  const shift = (projection?.depth ?? (active?.parentId ? 1 : 0)) * INDENT;
  // The top-level task above each top-level row, for the row menu's "Sub-item of".
  const above = new Map<string, Item>();
  let prevTop: Item | undefined;
  for (const f of visible) {
    if (f.parentId) continue;
    if (prevTop) above.set(f.item.id, prevTop);
    prevTop = f.item;
  }

  return (
    <DndContext
      // Stable, unique id so dnd-kit's aria-describedby is deterministic
      // across SSR and client. Without it, dnd-kit falls back to a global
      // counter that diverges between server and client and warns on hydration.
      id={`item-list-${projectId}`}
      sensors={sensors}
      collisionDetection={closestRow}
      // A dragged parent's sub-items leave the list, so re-measure the rows.
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            "To move an item, press Space. Use the up and down arrows to move it, right to make it a sub-item of the task above and left to move it out of a checklist. Press Space to drop it, or Escape to cancel.",
        },
      }}
      onDragStart={({ active }) => {
        const id = String(active.id);
        setActiveId(id);
        setOverId(id);
        live.current.offsetX = 0;
        live.current.activeDepth = byId.get(id)?.parentId ? 1 : 0;
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
        navigator.vibrate?.(10);
      }}
      onDragMove={({ active, over, delta }: DragMoveEvent) => {
        live.current.offsetX = delta.x;
        setOffsetX(delta.x);
        tickOnNewSpot(active.id, over?.id, delta.x);
      }}
      onDragOver={({ active, over, delta }) => {
        setOverId(over ? String(over.id) : null);
        tickOnNewSpot(active.id, over?.id, delta.x);
      }}
      onDragEnd={onDragEnd}
      onDragCancel={reset}
    >
      <SortableContext
        items={visible.map((f) => f.item.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="space-y-1.5">
          {visible.map((f, i) => {
            const { item } = f;
            const isActive = item.id === activeId;
            const children = childrenOf(item.id);
            const node = (drag: RowDrag) => {
              if (f.parentId) {
                return rowFor(row, item, {
                  drag,
                  parentTitle: byId.get(f.parentId)?.item.title,
                });
              }
              // A plain task can become a sub-item of the task just above it.
              const prev = above.get(item.id);
              const canNest = children.length === 0 && prev !== undefined;
              return rowFor(row, item, {
                drag,
                nestUnder: canNest ? { id: prev.id, title: prev.title } : undefined,
                checklist:
                  children.length > 0
                    ? {
                        ...progress(children),
                        expanded: !collapsed.has(item.id),
                        onToggle: () => onToggleCollapsed(item.id),
                      }
                    : undefined,
              });
            };
            return (
              <Sortable key={item.id} id={item.id}>
                {(drag) => {
                  // The dragged row stays in the list as the drop placeholder,
                  // indented to the depth it would land at, without tree lines.
                  const depth = isActive
                    ? (projection?.depth ?? (f.parentId ? 1 : 0))
                    : f.parentId
                      ? 1
                      : 0;
                  const next = visible[i + 1];
                  const last =
                    !next ||
                    next.parentId !== f.parentId ||
                    (next.item.id === activeId &&
                      visible[i + 2]?.parentId !== f.parentId);
                  const lines =
                    f.parentId && !isActive
                      ? last
                        ? BRANCH
                        : `${BRANCH} ${TRUNK}`
                      : undefined;
                  // The same elements at every depth, so a row that's nested or
                  // moved out keeps its DOM node, and keyboard focus with it.
                  return (
                    <div className={depth ? "ml-4 pl-5" : undefined}>
                      <div className={lines}>{node(drag)}</div>
                    </div>
                  );
                }}
              </Sortable>
            );
          })}
        </div>
      </SortableContext>
      {/* What follows the pointer: the row, with a parent's checklist, lifted
          off the list (scaled up with a deep shadow) until it's dropped. */}
      <DragOverlay modifiers={[lockX]} dropAnimation={dropAnimation}>
        {active && (
          <div
            // The column's own background, so rows under a parent's checklist
            // don't show through the gaps between its rows.
            className="cursor-grabbing rounded-lg bg-white shadow-xl transition-[margin,width,scale,box-shadow] duration-200 ease-out in-[.dnd-dropping]:scale-100! in-[.dnd-dropping]:shadow-none motion-safe:scale-[1.03] motion-safe:animate-[lift_150ms_ease-out] dark:bg-neutral-900"
            style={{
              marginLeft: shift,
              width: `calc(100% - ${shift}px)`,
            }}
          >
            {active.parentId ? (
              rowFor(row, active.item)
            ) : (
              <ItemGroupView
                {...row}
                group={{ ...active.item, children: childrenOf(active.item.id) }}
                defaultExpanded={!collapsed.has(active.item.id)}
              />
            )}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
