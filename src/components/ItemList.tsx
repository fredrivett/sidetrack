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
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useState, useTransition } from "react";
import { reorderItemAction } from "@/app/actions";
import type { AssigneeView } from "@/core/members";
import type { Item, ItemPrLink } from "@/core/schema";
import { ItemRow } from "./ItemRow";

export function ItemList({
  projectId,
  items,
  prefix,
  assignees,
  prLinksByItem,
  onOpenDetail,
}: {
  projectId: string;
  items: Item[];
  prefix: string;
  assignees: AssigneeView[];
  prLinksByItem: Record<string, ItemPrLink[]>;
  onOpenDetail: (item: Item) => void;
}) {
  const [optimistic, setOptimistic] = useState<Item[] | null>(null);
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
    // or 'top' if it now sits first.
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

  if (ordered.length === 0) {
    return (
      <p className="px-1 py-4 text-center text-xs text-neutral-400">
        No items yet — add one below.
      </p>
    );
  }

  return (
    <DndContext
      // Stable, unique id so dnd-kit's aria-describedby is deterministic
      // across SSR and client. Without it, dnd-kit falls back to a global
      // counter that diverges between server and client and warns on hydration.
      id={`item-list-${projectId}`}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <SortableContext
        items={ordered.map((i) => i.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="space-y-1.5">
          {ordered.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              prefix={prefix}
              assignees={assignees}
              prLinks={prLinksByItem[item.id] ?? []}
              draggable
              onOpenDetail={() => onOpenDetail(item)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
