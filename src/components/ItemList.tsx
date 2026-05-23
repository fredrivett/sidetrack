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
import type { Item } from "@/core/schema";
import { ItemRow } from "./ItemRow";

export function ItemList({ items }: { items: Item[] }) {
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
            <ItemRow key={item.id} item={item} draggable />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
