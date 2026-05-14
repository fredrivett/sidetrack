"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useTransition } from "react";
import {
  completeItemAction,
  deleteItemAction,
  reorderItemAction,
  uncompleteItemAction,
  updateItemAction,
} from "@/app/actions";
import type { Item } from "@/core/schema";
import { EditableText } from "./EditableText";

export function ItemRow({
  item,
  prevId,
  nextId,
  draggable,
}: {
  item: Item;
  prevId: string | null;
  nextId: string | null;
  draggable: boolean;
}) {
  const sortable = useSortable({ id: item.id, disabled: !draggable });
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    sortable;
  const [pending, start] = useTransition();
  const completed = item.completedAt !== null;

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : pending ? 0.7 : 1,
  };

  function moveUp() {
    if (!prevId) return;
    start(() => {
      void reorderItemAction(item.id, `before:${prevId}`);
    });
  }
  function moveDown() {
    if (!nextId) return;
    start(() => {
      void reorderItemAction(item.id, `after:${nextId}`);
    });
  }
  function toggle() {
    start(() => {
      void (completed ? uncompleteItemAction(item.id) : completeItemAction(item.id));
    });
  }
  function del() {
    if (!confirm(`Delete "${item.title}"?`)) return;
    start(() => {
      void deleteItemAction(item.id);
    });
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative flex items-start gap-2 rounded-lg border border-neutral-200 bg-white p-2 dark:border-neutral-800 dark:bg-neutral-900 ${
        item.kind === "milestone"
          ? "border-l-4 border-l-amber-400 dark:border-l-amber-500"
          : ""
      }`}
    >
      {draggable && (
        <button
          type="button"
          aria-label="Drag"
          className="cursor-grab touch-none px-1 text-neutral-400 hover:text-neutral-600 active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          ⋮⋮
        </button>
      )}

      <input
        type="checkbox"
        checked={completed}
        onChange={toggle}
        className="mt-1 h-4 w-4 shrink-0"
        aria-label={completed ? "Uncomplete" : "Complete"}
      />

      <div className="min-w-0 flex-1 space-y-0.5">
        <EditableText
          value={item.title}
          onSave={(next) => updateItemAction(item.id, { title: next })}
          className={`block w-full break-words text-sm ${
            completed ? "text-neutral-400 line-through" : ""
          } ${item.kind === "milestone" ? "font-medium" : ""}`}
          inputClassName="w-full text-sm"
        />
        {item.category && (
          <span className="inline-block rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500 dark:bg-neutral-800">
            {item.category}
          </span>
        )}
      </div>

      {draggable && (
        <div className="flex shrink-0 flex-col gap-1">
          <button
            type="button"
            aria-label="Move up"
            onClick={moveUp}
            disabled={!prevId || pending}
            className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-30 dark:hover:bg-neutral-800"
          >
            ↑
          </button>
          <button
            type="button"
            aria-label="Move down"
            onClick={moveDown}
            disabled={!nextId || pending}
            className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-30 dark:hover:bg-neutral-800"
          >
            ↓
          </button>
        </div>
      )}

      <button
        type="button"
        aria-label="Delete"
        onClick={del}
        className="shrink-0 self-start rounded p-1 text-neutral-300 opacity-0 transition hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 dark:hover:bg-red-950/30"
      >
        ×
      </button>
    </div>
  );
}
