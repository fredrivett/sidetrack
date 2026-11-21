"use client";

import { HeartHandshake, Quote } from "lucide-react";
import type { AssigneeView } from "@/core/members";
import type { Item, ItemPrLink, OnlyWithin } from "@/core/schema";
import type { DayTag } from "@/lib/dayTags";
import { nestItems } from "@/lib/itemTree";
import { Button } from "@/components/ui/button";
import { ItemDetailDialog } from "./ItemDetailDialog";
import { ItemGroupView } from "./ItemList";
import { UserAvatar } from "./UserAvatar";
import type { ProjectView } from "./Kanban";
import { useItemDetailDialog } from "./use-item-detail-dialog";

/** Someone who shares their today or week with the viewer, and the lists it covers. */
export type CheckIn = {
  personId: string;
  username: string | null;
  name: string;
  image: string | null;
  within: OnlyWithin;
  /** Their day (YYYY-MM-DD) it counts from: today, or the week's Monday. */
  day: string;
  /** What they wrote about today, and the mood they tapped, when they chose to share it. */
  note: string | null;
  mood: DayTag[];
  lists: ProjectView[];
};

const dayName = (day: string) =>
  day ? new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }) : "";

/**
 * The days people share with the viewer, one card each: what's on their
 * today (or week) across the lists they chose, and how much is done. These
 * lists aren't on the viewer's board: they follow someone's day rather than
 * work on it. The viewer can open an item to comment; nothing here edits.
 */
export function CheckInsView({
  checkIns,
  itemsByProject,
  assigneesByProject,
  prLinksByItem,
  viewerId,
  onShareDay,
}: {
  checkIns: CheckIn[];
  itemsByProject: Record<string, Item[]>;
  assigneesByProject: Record<string, AssigneeView[]>;
  prLinksByItem: Record<string, ItemPrLink[]>;
  viewerId: string;
  /** Opens Share my day, with someone to share it with already filled in. */
  onShareDay: (person?: string) => void;
}) {
  const all = checkIns.flatMap((c) => c.lists.flatMap((l) => itemsByProject[l.id] ?? []));
  const projectOf = new Map(checkIns.flatMap((c) => c.lists.map((l) => [l.id, l] as const)));
  const detail = useItemDetailDialog(all);
  const detailProject = detail.item ? projectOf.get(detail.item.projectId) : undefined;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-xl space-y-4 px-3 pt-6 pb-[max(0.75rem,env(safe-area-inset-bottom))] min-[900px]:pt-12">
        {checkIns.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center text-sm text-neutral-500">
            <HeartHandshake className="size-8 text-neutral-400" aria-hidden />
            <p>
              Nobody shares their day with you yet. Share yours with someone who’ll keep you
              going, and they’ll see what’s on your today here.
            </p>
            <Button size="sm" onClick={() => onShareDay()}>
              Share my day
            </Button>
          </div>
        ) : (
          <>
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => onShareDay()}>
              Share my day
            </Button>
          </div>
          {checkIns.map((c) => {
            const items = c.lists.flatMap((l) => itemsByProject[l.id] ?? []);
            const top = items.filter((i) => i.parentId === null);
            const done = top.filter((i) => i.completedAt !== null).length;
            const open = nestItems(items).filter((g) => g.completedAt === null);
            const finished = nestItems(items).filter((g) => g.completedAt !== null);
            const groupView = (group: (typeof open)[number]) => {
              const list = projectOf.get(group.projectId);
              return (
                <ItemGroupView
                  key={group.id}
                  group={group}
                  list={c.lists.length > 1 ? list : undefined}
                  prefix={list?.refPrefix ?? ""}
                  assignees={assigneesByProject[group.projectId] ?? []}
                  viewerId={viewerId}
                  prLinksByItem={prLinksByItem}
                  onOpenDetail={detail.openDetail}
                />
              );
            };
            const span = c.within === "today" ? "day" : "week";
            const share = top.length ? done / top.length : 0;
            return (
              <section
                key={c.personId}
                aria-label={`${c.name}’s ${span}`}
                className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm dark:border-stone-800 dark:bg-neutral-950"
              >
                <header className="flex items-center gap-3 bg-gradient-to-br from-amber-50 via-stone-50 to-rose-50 px-4 pt-4 pb-3 dark:from-amber-950/30 dark:via-neutral-900 dark:to-rose-950/30">
                  <UserAvatar
                    user={{ userId: c.personId, displayUsername: c.username, name: c.name, email: null, image: c.image }}
                    size={44}
                    className="ring-2 ring-white dark:ring-neutral-900"
                  />
                  <div className="min-w-0">
                    <h2 className="truncate font-display text-[22px] leading-tight text-neutral-900 italic dark:text-neutral-100">
                      {c.name}’s {span}
                    </h2>
                    <p className="text-xs text-neutral-500">
                      {c.within === "today" ? dayName(c.day) : `Week of ${dayName(c.day)}`}
                    </p>
                  </div>
                </header>
                {(c.mood.length > 0 || c.note) && (
                  <div className="space-y-2 border-b border-stone-100 bg-stone-50/60 px-4 py-3 dark:border-stone-800/60 dark:bg-neutral-900/40">
                    {c.note && (
                      <blockquote className="flex gap-2 font-serif text-[15px] leading-relaxed text-neutral-700 dark:text-neutral-300">
                        <Quote aria-hidden className="mt-1 size-3.5 shrink-0 text-stone-400" />
                        <span className="text-pretty">{c.note}</span>
                      </blockquote>
                    )}
                    {c.mood.length > 0 && (
                      <ul aria-label="How today feels" className={`flex flex-wrap gap-1.5 ${c.note ? "pl-[22px]" : ""}`}>
                        {c.mood.map((tag) => (
                          <li
                            key={tag}
                            className="rounded-full border border-stone-300 bg-stone-100 px-2 py-0.5 text-xs text-stone-800 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100"
                          >
                            {tag}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                <div className="space-y-3 px-4 py-3">
                  <div className="space-y-1.5">
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="font-medium text-neutral-700 dark:text-neutral-300">
                        {top.length === 0 ? "Nothing planned yet" : done === top.length ? "All done" : "Progress"}
                      </span>
                      <span className="tabular-nums text-neutral-500">
                        {done} of {top.length} done
                      </span>
                    </div>
                    <div
                      role="progressbar"
                      aria-label={`${c.name}’s progress`}
                      aria-valuemin={0}
                      aria-valuemax={top.length}
                      aria-valuenow={done}
                      className="h-1.5 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800"
                    >
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-[width] duration-500 dark:bg-emerald-400"
                        style={{ width: `${Math.round(share * 100)}%` }}
                      />
                    </div>
                  </div>
                  {top.length === 0 ? (
                    <p className="text-xs text-neutral-500">
                      Nothing on {c.within === "today" ? "today" : "this week"} yet.
                    </p>
                  ) : (
                    <>
                      {open.length > 0 && (
                        <div className="space-y-1.5">
                          <h3 className="text-[11px] font-medium tracking-wide text-neutral-400 uppercase">To do</h3>
                          {open.map(groupView)}
                        </div>
                      )}
                      {finished.length > 0 && (
                        <div className="space-y-1.5">
                          <h3 className="text-[11px] font-medium tracking-wide text-neutral-400 uppercase">Done</h3>
                          {finished.map(groupView)}
                        </div>
                      )}
                    </>
                  )}
                </div>
                {c.username && (
                  <div className="border-t border-stone-100 px-2 py-1.5 dark:border-stone-800/60">
                    <Button variant="ghost" size="sm" className="text-neutral-500" onClick={() => onShareDay(c.username ?? undefined)}>
                      <HeartHandshake aria-hidden className="size-3.5" />
                      Share your {span} with {c.name} too
                    </Button>
                  </div>
                )}
              </section>
            );
          })}
          </>
        )}
      </div>

      {detail.item && detailProject && (
        <ItemDetailDialog
          item={detail.item}
          parent={all.find((i) => i.id === detail.item?.parentId) ?? null}
          checklist={all.filter((i) => i.parentId === detail.item?.id)}
          // Nothing to nest under: they can't change someone else's day.
          nestTargets={[]}
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
