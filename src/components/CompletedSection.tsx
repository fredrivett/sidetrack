"use client";

import { useState } from "react";
import type { AssigneeView } from "@/core/members";
import type { Item, ItemPrLink } from "@/core/schema";
import { ItemRow } from "./ItemRow";

export function CompletedSection({
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
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;
  // items are sorted by position ASC; newest-completed (closest to active
  // boundary) is the LAST one in the completed range.
  const newest = items[items.length - 1];
  const shown = expanded ? items : [newest];

  return (
    <section className="space-y-1.5">
      <div className="space-y-1.5">
        {shown.map((it) => (
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
      {items.length > 1 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full text-left text-xs font-medium text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
        >
          {expanded
            ? "Hide completed"
            : `Show ${items.length - 1} more completed`}
        </button>
      )}
    </section>
  );
}
