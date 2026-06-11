"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import {
  completeItemAction,
  deleteItemAction,
  uncompleteItemAction,
} from "@/app/actions";
import type { Item, ItemPrLink } from "@/core/schema";
import { prLabel } from "@/lib/pr";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CategoryBadge } from "./CategoryBadge";
import { ItemDetailSheet } from "./ItemDetailSheet";

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
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
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
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
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
        <button
          type="button"
          onClick={() => setDetailOpen(true)}
          className="block w-full space-y-0.5 text-left"
        >
          <span
            className={`block w-full break-words text-sm ${
              completed ? "text-neutral-400 line-through" : ""
            } ${item.kind === "milestone" ? "font-medium" : ""}`}
          >
            {item.title}
          </span>
          {item.description && (
            <span className="block w-full whitespace-pre-wrap break-words text-xs text-neutral-500 dark:text-neutral-400">
              {item.description}
            </span>
          )}
          {item.category && <CategoryBadge category={item.category} />}
        </button>
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

      <DropdownMenu
        onOpenChange={(open) => {
          if (!open) setConfirmingDelete(false);
        }}
      >
        <DropdownMenuTrigger
          aria-label="Item options"
          disabled={pending}
          onPointerDown={(e) => e.stopPropagation()}
          className="shrink-0 self-start rounded p-1 text-neutral-300 opacity-0 transition hover:bg-neutral-100 hover:text-neutral-600 group-hover:opacity-100 disabled:opacity-50 dark:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
        >
          ⋯
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem
            variant="destructive"
            closeOnClick={false}
            onClick={del}
            className={
              confirmingDelete
                ? "bg-destructive! text-white! focus:bg-destructive! focus:text-white!"
                : undefined
            }
          >
            <Trash2 className={confirmingDelete ? "text-white!" : "opacity-70"} />
            {confirmingDelete ? "Confirm delete?" : "Delete item"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ItemDetailSheet
        item={item}
        prLinks={prLinks}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </div>
  );
}
