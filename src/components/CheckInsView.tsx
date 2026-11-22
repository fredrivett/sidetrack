"use client";

import { useTransition, type ReactNode } from "react";
import { Ellipsis, HeartHandshake, Plus, Quote } from "lucide-react";
import { stopDayShareAction, updateDayShareAction } from "@/app/actions";
import type { DayShare } from "@/core/dayShares";
import type { AssigneeView } from "@/core/members";
import type { Item, ItemPrLink, OnlyWithin } from "@/core/schema";
import type { DayTag } from "@/lib/dayTags";
import { nestItems } from "@/lib/itemTree";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ItemDetailDialog } from "./ItemDetailDialog";
import { ItemGroupView } from "./ItemList";
import { UserAvatar } from "./UserAvatar";
import type { ProjectView } from "./Kanban";
import { runAction } from "./run-action";
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

/** The viewer's own day, as Check-ins shows it, and who they share it with. */
export type MyDay = {
  within: OnlyWithin;
  /** Their day (YYYY-MM-DD): today, or the week's Monday. */
  day: string;
  note: string | null;
  mood: DayTag[];
  /** Their items in the day they share (mySharedDay). */
  itemIds: string[];
  shares: DayShare[];
};

const NO_ONE: MyDay = { within: "today", day: "", note: null, mood: [], itemIds: [], shares: [] };

const dayName = (day: string) =>
  day ? new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }) : "";

/** "Today · mood and note", what someone sees of the viewer's day. */
function seesWords(s: DayShare): string {
  if (s.pending) return "Invite pending";
  const extra = [s.mood && "mood", s.note && "note"].filter(Boolean).join(" and ");
  return [s.within === "today" ? "Today" : "This week", extra].filter(Boolean).join(" · ");
}

/**
 * Check-ins, side by side: the viewer's own day and who sees it, then the
 * days people share with them, one card each. Those lists aren't on the
 * viewer's board: they follow someone's day rather than work on it, and can
 * open an item to comment; nothing on someone else's day edits.
 */
export function CheckInsView({
  checkIns,
  myDay = NO_ONE,
  viewer,
  itemsByProject,
  projectsById,
  assigneesByProject,
  prLinksByItem,
  parentTitles,
  viewerId,
  onShareDay,
}: {
  checkIns: CheckIn[];
  myDay?: MyDay;
  viewer: { name: string; username: string | null; image: string | null };
  itemsByProject: Record<string, Item[]>;
  /** The viewer's lists, to show their own items with. */
  projectsById: Map<string, ProjectView>;
  assigneesByProject: Record<string, AssigneeView[]>;
  prLinksByItem: Record<string, ItemPrLink[]>;
  /** Titles of items they can't see that hold sub-items they can. */
  parentTitles: Record<string, string>;
  viewerId: string;
  /** Opens Share my day, with someone to share it with already filled in. */
  onShareDay: (person?: string) => void;
}) {
  const theirs = checkIns.flatMap((c) => c.lists.flatMap((l) => itemsByProject[l.id] ?? []));
  const mineIds = new Set(myDay.itemIds);
  const mine = Object.values(itemsByProject)
    .flat()
    .filter((i) => mineIds.has(i.id));
  const all = [...theirs, ...mine];
  const projectOf = new Map([
    ...projectsById,
    ...checkIns.flatMap((c) => c.lists.map((l) => [l.id, l] as const)),
  ]);
  const detail = useItemDetailDialog(all);
  const detailProject = detail.item ? projectOf.get(detail.item.projectId) : undefined;
  const sharesBack = new Set(myDay.shares.map((s) => s.personId));

  // A sub-item shown without its item (someone else's, on their list) says
  // which item it's under: its title is all of it that's shared.
  const loaded = new Map(Object.values(itemsByProject).flat().map((i) => [i.id, i.title]));
  const under = (group: Item) => group.parentId && (loaded.get(group.parentId) ?? parentTitles[group.parentId]);

  const groups = (items: Item[], many: boolean) =>
    nestItems(items).map((group) => {
      const list = projectOf.get(group.projectId);
      const parent = under(group);
      return {
        done: group.completedAt !== null,
        node: (
          <div key={group.id} className="space-y-1">
            {parent && <p className="truncate px-1 text-xs text-neutral-500">Under “{parent}”</p>}
            <ItemGroupView
              group={group}
              list={many ? list : undefined}
              prefix={list?.refPrefix ?? ""}
              assignees={assigneesByProject[group.projectId] ?? []}
              viewerId={viewerId}
              prLinksByItem={prLinksByItem}
              onOpenDetail={detail.openDetail}
            />
          </div>
        ),
      };
    });

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto grid w-full max-w-5xl items-start gap-6 px-3 pt-6 pb-[max(0.75rem,env(safe-area-inset-bottom))] min-[900px]:grid-cols-2 min-[900px]:pt-12">
        <div className="min-w-0 space-y-2">
          <h2 className="px-1 text-xs font-medium text-neutral-500">What you share</h2>
          <DayCard
            label="Your day"
            title={myDay.within === "week" ? "Your week" : "Your day"}
            person={{ userId: viewerId, displayUsername: viewer.username, name: viewer.name, email: null, image: viewer.image }}
            sub={myDay.day ? (myDay.within === "today" ? dayName(myDay.day) : `Week of ${dayName(myDay.day)}`) : "Shared with nobody yet"}
            note={myDay.note}
            mood={myDay.mood}
            items={mine}
            groups={groups(mine, new Set(mine.map((i) => i.projectId)).size > 1)}
            empty={myDay.shares.length ? "Nothing of yours is due in it yet." : "Share your day and what’s due on it shows here, as they see it."}
            footer={
              <div className="space-y-1 border-t border-stone-100 px-4 py-3 dark:border-stone-800/60">
                <h3 className="pb-1 text-xs text-neutral-500">
                  {myDay.shares.length ? "Who sees your day" : "Only you see this."}
                </h3>
                {myDay.shares.map((s) => (
                  <ShareRow key={s.personId} share={s} />
                ))}
                <Button
                  variant={myDay.shares.length ? "ghost" : "outline"}
                  size="sm"
                  className={myDay.shares.length ? "-ml-2 text-neutral-500" : ""}
                  onClick={() => onShareDay()}
                >
                  {myDay.shares.length ? <Plus aria-hidden className="size-3.5" /> : <HeartHandshake aria-hidden className="size-3.5" />}
                  {myDay.shares.length ? "Share with someone else" : "Share my day"}
                </Button>
              </div>
            }
          />
        </div>

        <div className="min-w-0 space-y-2">
          <h2 className="px-1 text-xs font-medium text-neutral-500">Following</h2>
          {checkIns.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-stone-200 px-4 py-8 text-center text-sm text-neutral-500 dark:border-stone-800">
              Nobody shares their day with you yet. When someone does, it shows here.
            </div>
          ) : (
            <div className="space-y-4">
              {checkIns.map((c) => {
                const items = c.lists.flatMap((l) => itemsByProject[l.id] ?? []);
                const span = c.within === "today" ? "day" : "week";
                return (
                  <DayCard
                    key={c.personId}
                    label={`${c.name}’s ${span}`}
                    title={`${c.name}’s ${span}`}
                    person={{ userId: c.personId, displayUsername: c.username, name: c.name, email: null, image: c.image }}
                    sub={c.within === "today" ? dayName(c.day) : `Week of ${dayName(c.day)}`}
                    note={c.note}
                    mood={c.mood}
                    items={items}
                    groups={groups(items, c.lists.length > 1)}
                    empty={`Nothing on ${c.within === "today" ? "today" : "this week"} yet.`}
                    footer={
                      c.username && !sharesBack.has(c.personId) ? (
                        <div className="border-t border-stone-100 px-2 py-1.5 dark:border-stone-800/60">
                          <Button variant="ghost" size="sm" className="text-neutral-500" onClick={() => onShareDay(c.username ?? undefined)}>
                            <HeartHandshake aria-hidden className="size-3.5" />
                            Share your day with {c.name} too
                          </Button>
                        </div>
                      ) : null
                    }
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>

      {detail.item && detailProject && (
        <ItemDetailDialog
          item={detail.item}
          parent={all.find((i) => i.id === detail.item?.parentId) ?? null}
          parentTitle={under(detail.item) || undefined}
          checklist={all.filter((i) => i.parentId === detail.item?.id)}
          // Nothing to nest under here: Check-ins follows a day, it doesn't plan one.
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

/** One day, as a card: who and when, their note and mood, progress, then to do and done. */
function DayCard({
  label,
  title,
  person,
  sub,
  note,
  mood,
  items,
  groups,
  empty,
  footer,
}: {
  label: string;
  title: string;
  person: { userId: string; displayUsername: string | null; name: string; email: null; image: string | null };
  sub: string;
  note: string | null;
  mood: DayTag[];
  items: Item[];
  groups: { done: boolean; node: ReactNode }[];
  empty: string;
  footer: ReactNode;
}) {
  // Each row counts once: an item, or a sub-item shown without its item.
  const ids = new Set(items.map((i) => i.id));
  const top = items.filter((i) => i.parentId === null || !ids.has(i.parentId));
  const done = top.filter((i) => i.completedAt !== null).length;
  const open = groups.filter((g) => !g.done);
  const finished = groups.filter((g) => g.done);
  return (
    <section
      aria-label={label}
      className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm dark:border-stone-800 dark:bg-neutral-950"
    >
      <header className="flex items-center gap-3 bg-gradient-to-br from-amber-50 via-stone-50 to-rose-50 px-4 pt-4 pb-3 dark:from-amber-950/30 dark:via-neutral-900 dark:to-rose-950/30">
        <UserAvatar user={person} size={44} className="ring-2 ring-white dark:ring-neutral-900" />
        <div className="min-w-0">
          <p className="truncate font-display text-[22px] leading-tight text-neutral-900 italic dark:text-neutral-100">{title}</p>
          <p className="text-xs text-neutral-500">{sub}</p>
        </div>
      </header>
      {(mood.length > 0 || note) && (
        <div className="space-y-2 border-b border-stone-100 bg-stone-50/60 px-4 py-3 dark:border-stone-800/60 dark:bg-neutral-900/40">
          {note && (
            <blockquote className="flex gap-2 font-serif text-[15px] leading-relaxed text-neutral-700 dark:text-neutral-300">
              <Quote aria-hidden className="mt-1 size-3.5 shrink-0 text-stone-400" />
              <span className="text-pretty">{note}</span>
            </blockquote>
          )}
          {mood.length > 0 && (
            <ul aria-label="How today feels" className={`flex flex-wrap gap-1.5 ${note ? "pl-[22px]" : ""}`}>
              {mood.map((tag) => (
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
            aria-label={`${label}: progress`}
            aria-valuemin={0}
            aria-valuemax={top.length}
            aria-valuenow={done}
            className="h-1.5 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800"
          >
            <div
              className="h-full rounded-full bg-emerald-500 transition-[width] duration-500 dark:bg-emerald-400"
              style={{ width: `${top.length ? Math.round((done / top.length) * 100) : 0}%` }}
            />
          </div>
        </div>
        {top.length === 0 ? (
          <p className="text-xs text-neutral-500">{empty}</p>
        ) : (
          <>
            {open.length > 0 && (
              <div className="space-y-1.5">
                <h3 className="text-[11px] font-medium tracking-wide text-neutral-400 uppercase">To do</h3>
                {open.map((g) => g.node)}
              </div>
            )}
            {finished.length > 0 && (
              <div className="space-y-1.5">
                <h3 className="text-[11px] font-medium tracking-wide text-neutral-400 uppercase">Done</h3>
                {finished.map((g) => g.node)}
              </div>
            )}
          </>
        )}
      </div>
      {footer}
    </section>
  );
}

/**
 * Someone who sees the viewer's day: what of it, and a ⋯ menu to change it.
 * Each change holds the row (the server decides what they then see), and a
 * failure says so.
 */
function ShareRow({ share: s }: { share: DayShare }) {
  const [saving, start] = useTransition();
  const save = (action: () => Promise<unknown>, what: string) =>
    !saving &&
    start(async () => {
      await runAction(action(), what);
    });
  return (
    <div
      aria-disabled={saving || undefined}
      aria-busy={saving || undefined}
      className="flex min-h-8 items-center gap-2 text-sm aria-disabled:opacity-50"
    >
      <UserAvatar
        user={{ userId: s.personId, displayUsername: s.username, name: s.name, email: null, image: s.image }}
        size={22}
      />
      <span className="min-w-0 flex-1 truncate">
        {s.name} <span className="text-xs text-neutral-500">{seesWords(s)}</span>
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`What ${s.name} sees`}
          aria-disabled={saving || undefined}
          className="rounded p-1 text-neutral-500 hover:bg-neutral-100 aria-disabled:pointer-events-none dark:hover:bg-neutral-800"
        >
          <Ellipsis aria-hidden className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          <DropdownMenuRadioGroup
            value={s.within}
            onValueChange={(v) => v !== s.within && save(() => updateDayShareAction(s.personId, { within: v as OnlyWithin }), `change what ${s.name} sees`)}
          >
            <DropdownMenuRadioItem value="today">Just today</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="week">This week</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            checked={s.mood}
            onCheckedChange={(on) => save(() => updateDayShareAction(s.personId, { mood: on }), `change what ${s.name} sees`)}
          >
            How today feels
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={s.note}
            onCheckedChange={(on) => save(() => updateDayShareAction(s.personId, { note: on }), `change what ${s.name} sees`)}
          >
            My day note
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => save(() => stopDayShareAction(s.personId), `stop sharing your day with ${s.name}`)}
          >
            Stop sharing with {s.name}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
