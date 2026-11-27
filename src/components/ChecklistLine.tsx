import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { RowDrag } from "./ItemRow";

/**
 * One line of a checklist: its checkbox, then its title and badges as a
 * button that opens it, then what's at the end (people, remove). The item
 * dialog's checklist and New item's draft one both use it, so a line looks
 * and hovers the same before and after the item is added.
 */
export function ChecklistLine({
  checkbox,
  title,
  done,
  badges,
  end,
  onOpen,
  disabled,
  autoFocus,
  drag,
  lifted = false,
  itemRef,
}: {
  checkbox: ReactNode;
  title: string;
  done: boolean;
  /** After the title, inside the button. */
  badges?: ReactNode;
  end?: ReactNode;
  onOpen: () => void;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Drags the line to reorder it. */
  drag?: RowDrag;
  /** The copy following the pointer while it's dragged. */
  lifted?: boolean;
  itemRef?: string;
}) {
  return (
    <div
      {...drag?.attributes}
      {...drag?.listeners}
      ref={drag?.setActivatorNodeRef}
      aria-label={drag ? `Reorder ${title}` : undefined}
      data-item-ref={itemRef}
      className={cn(
        "flex items-center gap-2 rounded-md px-1 py-0.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-neutral-400",
        drag && "touch-manipulation",
        // While dragged, the line stays behind as the slot it would drop into.
        drag?.isDragging
          ? "bg-neutral-100 *:invisible dark:bg-neutral-800/50"
          : // Shaded like a card, not underlined like a link. Not on the
            // copy following the pointer, always under it.
            !lifted && "hover:bg-neutral-50 dark:hover:bg-neutral-800/40",
      )}
    >
      {checkbox}
      <button
        type="button"
        autoFocus={autoFocus}
        onClick={onOpen}
        disabled={disabled}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm"
      >
        <span className={cn("min-w-0 truncate", done && "text-neutral-400 line-through")}>
          {title}
        </span>
        {badges}
      </button>
      {end}
    </div>
  );
}
