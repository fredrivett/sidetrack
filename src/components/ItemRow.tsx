"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useTransition } from "react";
import {
  completeItemAction,
  deleteItemAction,
  uncompleteItemAction,
  updateItemAction,
} from "@/app/actions";
import type { Item, ItemPrLink } from "@/core/schema";
import { EditableText } from "./EditableText";

function prLabel(url: string): string {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (m) return `${m[1]}/${m[2]}#${m[3]}`;
  return url;
}

export function ItemRow({
  item,
  prLinks,
  draggable,
}: {
  item: Item;
  prLinks: ItemPrLink[];
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
      {...(draggable ? attributes : {})}
      {...(draggable ? listeners : {})}
      className={`group relative flex items-start gap-2 rounded-lg border border-neutral-200 bg-white p-2 dark:border-neutral-800 dark:bg-neutral-900 ${
        draggable ? "cursor-grab touch-manipulation active:cursor-grabbing" : ""
      } ${
        item.kind === "milestone"
          ? "border-l-4 border-l-amber-400 dark:border-l-amber-500"
          : ""
      }`}
    >
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
        <EditableText
          value={item.description ?? ""}
          onSave={(next) =>
            updateItemAction(item.id, { description: next || null })
          }
          multiline
          placeholder="Add description…"
          className={`block w-full whitespace-pre-wrap break-words text-xs ${
            item.description
              ? "text-neutral-500 dark:text-neutral-400"
              : "hidden text-neutral-400 group-hover:block"
          }`}
          inputClassName="w-full text-xs"
        />
        {item.category && (
          <span className="inline-block rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500 dark:bg-neutral-800">
            {item.category}
          </span>
        )}
        {prLinks.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {prLinks.map((link) => (
              <a
                key={link.id}
                href={link.prUrl}
                target="_blank"
                rel="noreferrer noopener"
                onPointerDown={(e) => e.stopPropagation()}
                className="inline-block rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-950/70"
              >
                {prLabel(link.prUrl)}
              </a>
            ))}
          </div>
        )}
      </div>

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
