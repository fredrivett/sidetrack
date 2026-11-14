"use client";

import { ChevronRight } from "lucide-react";
import { useState } from "react";
import type { AssigneeView } from "@/core/members";
import type { Item, ItemPrLink } from "@/core/schema";
import { ItemRow } from "./ItemRow";

/**
 * Items finished before today, collapsed at the bottom of the list. `items`
 * arrive newest-completed first. Items finished today stay in place in the
 * main list instead, crossed out, until the day turns over.
 */
export function DoneSection({
  items,
  prefix,
  assignees,
  viewerId,
  prLinksByItem,
  onOpenDetail,
}: {
  items: Item[];
  prefix: string;
  assignees: AssigneeView[];
  viewerId: string;
  prLinksByItem: Record<string, ItemPrLink[]>;
  onOpenDetail: (item: Item) => void;
}) {
  // Rendered only while there are items, so it starts collapsed again each
  // time the section reappears.
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="space-y-1.5">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex items-center gap-1 text-xs font-medium text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
      >
        <ChevronRight
          className={`size-3.5 transition-transform ${expanded ? "rotate-90" : ""}`}
        />
        Done ({items.length})
      </button>
      {expanded && (
        <div className="space-y-1.5">
          {items.map((it) => (
            <ItemRow
              key={it.id}
              item={it}
              prefix={prefix}
              assignees={assignees}
              viewerId={viewerId}
              prLinks={prLinksByItem[it.id] ?? []}
              draggable={false}
              onOpenDetail={() => onOpenDetail(it)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
