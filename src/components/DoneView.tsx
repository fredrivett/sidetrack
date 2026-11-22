"use client";

import { useEffect, useRef } from "react";
import type { AssigneeView } from "@/core/members";
import type { Item, ItemPrLink } from "@/core/schema";
import { dayLabel } from "@/lib/time";
import { Button } from "@/components/ui/button";
import { ItemDetailDialog } from "./ItemDetailDialog";
import { ItemRow } from "./ItemRow";
import type { ProjectView } from "./Kanban";
import { useToday } from "./use-day-start";
import { useItemDetailDialog } from "./use-item-detail-dialog";

/**
 * Everything finished across the lists on the board, newest first, under a
 * heading per day. The board's items cover this week; older ones load in
 * pages as the end of the list scrolls into view (see Kanban), and `since`
 * is how far back they reach. Sub-items show as their own rows, naming
 * their parent. The header's filters don't apply: this is the record of
 * everything finished.
 */
export function DoneView({
  projects,
  itemsByProject,
  assigneesByProject,
  prLinksByItem,
  viewerId,
  since,
  more,
  loading,
  failed,
  onLoadMore,
  onRetry,
  onOpenItem,
}: {
  /** The lists on the board; archived lists stay out. */
  projects: Pick<ProjectView, "id" | "name" | "refPrefix">[];
  itemsByProject: Record<string, Item[]>;
  assigneesByProject: Record<string, AssigneeView[]>;
  prLinksByItem: Record<string, ItemPrLink[]>;
  viewerId: string;
  /** Items finished at or after this are all loaded. */
  since: number;
  /** Whether older finished items remain to load. */
  more: boolean;
  loading: boolean;
  /** The last read failed; paging waits for `onRetry`. */
  failed: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
  /** Opens a row's item instead of its dialog, in the landing page's preview. */
  onOpenItem?: (item: Item) => void;
}) {
  // Day labels depend on the viewer's clock, so rows wait for the browser.
  const known = useToday() !== null;

  const all = projects.flatMap((p) => itemsByProject[p.id] ?? []);
  const byId = new Map(all.map((i) => [i.id, i]));
  const projectOf = new Map(projects.map((p) => [p.id, p]));
  const detail = useItemDetailDialog(all);

  const done = all
    .filter(
      (i): i is Item & { completedAt: number } =>
        i.completedAt !== null && i.completedAt >= since,
    )
    .sort((a, b) => b.completedAt - a.completedAt || b.id.localeCompare(a.id));
  const days: Array<[string, Item[]]> = [];
  for (const item of done) {
    const label = dayLabel(item.completedAt);
    const last = days.at(-1);
    if (last?.[0] === label) last[1].push(item);
    else days.push([label, [item]]);
  }

  // Load the next page whenever the end of the list is in view, including
  // straight after a page lands that didn't fill the screen.
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = end.current;
    if (!known || !more || loading || failed || !el) return;
    const io = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && onLoadMore(),
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [known, more, loading, failed, onLoadMore]);

  const detailProject = detail.item ? projectOf.get(detail.item.projectId) : undefined;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-xl space-y-4 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {known &&
          days.map(([label, rows]) => (
            <section key={label} className="space-y-1.5">
              <h2 className="flex items-center gap-1.5 px-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                {label}
                <span className="tabular-nums text-neutral-400 dark:text-neutral-500">
                  {rows.length}
                </span>
              </h2>
              {rows.map((item) => {
                const project = projectOf.get(item.projectId);
                const parent = item.parentId ? byId.get(item.parentId) : undefined;
                return (
                  <ItemRow
                    key={item.id}
                    item={item}
                    prefix={project?.refPrefix ?? ""}
                    assignees={assigneesByProject[item.projectId] ?? []}
                    viewerId={viewerId}
                    prLinks={prLinksByItem[item.id] ?? []}
                    context={[project?.name, parent?.title].filter(Boolean).join(" › ")}
                    onOpenDetail={() => (onOpenItem ?? detail.openDetail)(item)}
                  />
                );
              })}
            </section>
          ))}

        <div ref={end} className="py-6 text-center text-sm text-neutral-400">
          {known && failed ? (
            <>
              {"Couldn't load older items. "}
              <Button variant="link" size="sm" className="relative h-auto p-0 touch:h-auto touch:p-0 touch:after:absolute touch:after:-inset-x-2 touch:after:-inset-y-3" onClick={onRetry}>
                Try again
              </Button>
            </>
          ) : known && (more || loading)
            ? "Loading…"
            : known && done.length === 0
              ? "Nothing finished yet."
              : known && "That's everything."}
        </div>
      </div>

      {detail.item && detailProject && (
        <ItemDetailDialog
          item={detail.item}
          parent={all.find((i) => i.id === detail.item?.parentId) ?? null}
          checklist={all.filter((i) => i.parentId === detail.item?.id)}
          // The same rule as the board's dialog (ProjectColumn), within the
          // item's own list.
          nestTargets={all.filter(
            (i) =>
              i.projectId === detail.item?.projectId &&
              i.parentId === null &&
              i.completedAt === null &&
              i.id !== detail.item?.id,
          )}
          onOpenItem={detail.goTo}
          history={detail.history}
          prefix={detailProject.refPrefix}
          assignees={assigneesByProject[detail.item.projectId] ?? []}
          viewerId={viewerId}
          prLinks={prLinksByItem[detail.item.id] ?? []}
          open={detail.open}
          onOpenChange={detail.onOpenChange}
        />
      )}
    </div>
  );
}
