"use client";

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { type ReactNode, useState, useTransition } from "react";
import { reorderItemAction } from "@/app/actions";
import type { AssigneeView } from "@/core/members";
import type { Item, ItemPrLink } from "@/core/schema";
import { ItemRow, type RowDrag } from "./ItemRow";

/** A top-level item with its sub-items, in list order. */
export type ItemGroup = Item & { children: Item[] };

type RowProps = {
  prefix: string;
  assignees: AssigneeView[];
  viewerId: string;
  prLinksByItem: Record<string, ItemPrLink[]>;
  onOpenDetail: (item: Item) => void;
};

/**
 * One draggable list: top-level items, or one parent's sub-items. Each level
 * gets its own DndContext, so a sub-item only drags within its parent and a
 * parent drags with its whole checklist.
 */
function SortableList<T extends Item>({
  id,
  items,
  render,
}: {
  id: string;
  items: T[];
  /** `prev` is the item above in the order shown, which may be mid-reorder. */
  render: (item: T, drag: RowDrag, at: { prev?: T; last: boolean }) => ReactNode;
}) {
  const [optimistic, setOptimistic] = useState<T[] | null>(null);
  const [, start] = useTransition();
  const ordered = optimistic ?? items;

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
  );

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = ordered.findIndex((i) => i.id === active.id);
    const newIdx = ordered.findIndex((i) => i.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;

    const next = [...ordered];
    const [moved] = next.splice(oldIdx, 1);
    next.splice(newIdx, 0, moved);
    setOptimistic(next);

    // Resolve position: place after the previous sibling in the new order,
    // or 'top' if it now sits first. Items finished today are in `ordered`
    // too, so this lands exactly where it was dropped.
    const prev = next[newIdx - 1];
    const ref = prev ? `after:${prev.id}` : "top";
    start(async () => {
      try {
        await reorderItemAction(String(active.id), ref);
      } finally {
        setOptimistic(null);
      }
    });
  }

  return (
    <DndContext
      // Stable, unique id so dnd-kit's aria-describedby is deterministic
      // across SSR and client. Without it, dnd-kit falls back to a global
      // counter that diverges between server and client and warns on hydration.
      id={id}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <SortableContext
        items={ordered.map((i) => i.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="space-y-1.5">
          {ordered.map((item, i) => (
            <Sortable key={item.id} id={item.id}>
              {(drag) =>
                render(item, drag, {
                  prev: ordered[i - 1],
                  last: i === ordered.length - 1,
                })
              }
            </Sortable>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

// The sortable node wraps the row and, for a parent, its sub-items, so they
// move together; the row itself carries the drag listeners.
function Sortable({
  id,
  children,
}: {
  id: string;
  children: (drag: RowDrag) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{
        // Translate, not Transform: groups differ in height, and a scale would
        // stretch a parent with its checklist into a neighbour's size.
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
    >
      {children({ attributes, listeners, isDragging })}
    </div>
  );
}

// A tree line from the parent's checkbox down to each sub-item, bending into
// it at its first line: an elbow from the gap above into the row, plus, for
// every sub-item but the last, the line carrying on down to the next one.
// Row maths: the gap between rows is 6px (space-y-1.5), and a row's first line
// is centred 19px into it (1px border + 8px padding + half a 20px line).
const BRANCH =
  "relative before:absolute before:-top-1.5 before:-left-5 before:h-[25px] before:w-5 before:rounded-bl-lg before:border-b-2 before:border-l-2 before:border-neutral-200 dark:before:border-neutral-700";
const TRUNK =
  "after:absolute after:top-0 after:-bottom-1.5 after:-left-5 after:border-l-2 after:border-neutral-200 dark:after:border-neutral-700";

/**
 * A top-level row followed by its sub-items, indented. Sub-items are draggable
 * among themselves when the parent is (the open list), and static in Done.
 */
export function ItemGroupView({
  group,
  drag,
  nestUnder,
  ...row
}: RowProps & {
  group: ItemGroup;
  drag?: RowDrag;
  nestUnder?: { id: string; title: string };
}) {
  const [expanded, setExpanded] = useState(true);
  const { children } = group;
  const rowFor = (item: Item, extra: Partial<Parameters<typeof ItemRow>[0]>) => (
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
  const branch = (last: boolean, node: ReactNode) => (
    <div className={last ? BRANCH : `${BRANCH} ${TRUNK}`}>{node}</div>
  );

  return (
    <div className="space-y-1.5">
      {rowFor(group, {
        drag,
        nestUnder,
        checklist:
          children.length > 0
            ? {
                done: children.filter((c) => c.completedAt !== null).length,
                total: children.length,
                expanded,
                onToggle: () => setExpanded((v) => !v),
              }
            : undefined,
      })}
      {expanded && children.length > 0 && (
        // The margin puts the tree line under the parent's checkbox; pl-5 leaves
        // room for each branch to bend into its row.
        <div className="ml-4 pl-5">
          {drag ? (
            <SortableList
              id={`item-children-${group.id}`}
              items={children}
              render={(child, childDrag, { last }) =>
                branch(
                  last,
                  rowFor(child, { drag: childDrag, parentTitle: group.title }),
                )
              }
            />
          ) : (
            <div className="space-y-1.5">
              {children.map((child, i) => (
                <div key={child.id}>
                  {branch(
                    i === children.length - 1,
                    rowFor(child, { parentTitle: group.title }),
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ItemList({
  projectId,
  groups,
  ...row
}: RowProps & {
  projectId: string;
  groups: ItemGroup[];
}) {
  if (groups.length === 0) {
    return (
      <p className="px-1 py-4 text-center text-xs text-neutral-400">
        Nothing to do — add an item from the list’s ⋯ menu.
      </p>
    );
  }

  return (
    <SortableList
      id={`item-list-${projectId}`}
      items={groups}
      render={(group, drag, { prev: above }) => {
        // A plain task can become a sub-item of the task just above it, as
        // shown (so mid-reorder it's the visual neighbour, not the stale one).
        const canNest =
          group.kind === "task" &&
          group.children.length === 0 &&
          above?.kind === "task";
        return (
          <ItemGroupView
            {...row}
            group={group}
            drag={drag}
            nestUnder={canNest ? { id: above.id, title: above.title } : undefined}
          />
        );
      }}
    />
  );
}
