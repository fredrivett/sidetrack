"use client";

import { useId, useState, useTransition, type ReactNode } from "react";
import { CircleCheck, Ellipsis, HeartHandshake, Mail, Plus, Quote } from "lucide-react";
import { toast } from "sonner";
import {
  acceptDayShareAction,
  cancelInvitationAction,
  declineDayShareAction,
  leaveDayShareAction,
  resendInvitationAction,
  stopDayShareAction,
  updateDayShareAction,
} from "@/app/actions";
import type { DayShare, DayShareInvite } from "@/core/dayShares";
import type { InvitationView } from "@/core/invitations";
import type { AssigneeView } from "@/core/members";
import type { Item, ItemPrLink, OnlyWithin } from "@/core/schema";
import type { SeenWrapUp } from "@/core/dayWrapUps";
import type { DayTag } from "@/lib/dayTags";
import { nestItems } from "@/lib/itemTree";
import { AGENDA_SECTIONS, agendaSection, type AgendaSection, weekday } from "@/lib/time";
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
import { OverdueCard } from "./AgendaView";
import { ItemDetailDialog } from "./ItemDetailDialog";
import { isHiddenParent, ItemGroupView, withHiddenParents } from "./ItemList";
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
  /** Their today, by their clock: what its items' due dates read from. */
  today: string;
  /** What they wrote about today, and the mood they tapped, when they chose to share it. */
  note: string | null;
  mood: DayTag[];
  /** How their today went, once they've closed it, as much as they share. */
  wrapUp: SeenWrapUp | null;
  /** The lists shared just for their day: only their items in it show. */
  lists: ProjectView[];
  /** Their items in it on lists the viewer sees whole (dayOnWholeLists). */
  alsoItemIds: string[];
};

/** The viewer's own day, as Check-ins shows it, and who they share it with. */
export type MyDay = {
  within: OnlyWithin;
  /** Their day (YYYY-MM-DD): today, or the week's Monday. */
  day: string;
  today: string;
  note: string | null;
  mood: DayTag[];
  wrapUp: SeenWrapUp | null;
  /** Their items in the day they share (mySharedDay). */
  itemIds: string[];
  shares: DayShare[];
  /** Invited by email, not joined yet. */
  invited: InvitationView[];
};

const NO_ONE: MyDay = { within: "today", day: "", today: "", note: null, mood: [], wrapUp: null, itemIds: [], shares: [], invited: [] };

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
  dayShareInvites = [],
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
  /** Shared days waiting for the viewer to accept. */
  dayShareInvites?: DayShareInvite[];
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
  const byIds = (ids: string[]) => {
    const wanted = new Set(ids);
    return Object.values(itemsByProject)
      .flat()
      .filter((i) => wanted.has(i.id));
  };
  // Theirs on the lists shared for it, then on the lists the viewer sees whole.
  const itemsOf = (c: CheckIn) => [...c.lists.flatMap((l) => itemsByProject[l.id] ?? []), ...byIds(c.alsoItemIds)];
  const theirs = checkIns.flatMap(itemsOf);
  const mine = byIds(myDay.itemIds);
  // An item on more than one day (a joint one) once.
  const all = [...new Map([...theirs, ...mine].map((i) => [i.id, i])).values()];
  const projectOf = new Map([
    ...projectsById,
    ...checkIns.flatMap((c) => c.lists.map((l) => [l.id, l] as const)),
  ]);
  const detail = useItemDetailDialog(all);
  const detailProject = detail.item ? projectOf.get(detail.item.projectId) : undefined;
  const sharesBack = new Set(myDay.shares.map((s) => s.personId));
  const sharing = myDay.shares.length + myDay.invited.length > 0;

  // Titles of the items those sub-items sit under: hidden ones' (parentTitles),
  // and, on the viewer's own card, ones they can see but aren't in their day.
  const titles = { ...Object.fromEntries(Object.values(itemsByProject).flat().map((i) => [i.id, i.title])), ...parentTitles };

  // Grouped by when they're due, by the sharer's clock, as the Brief groups
  // them (agendaSection); a group goes where its soonest open item does,
  // and once it's finished, under Done, or Cancelled if it was cancelled.
  const groups = (items: Item[], many: boolean, today: string) =>
    // Someone else's item holding sub-items of theirs shows by its title alone.
    nestItems(withHiddenParents(items, titles)).map((group) => {
      const list = projectOf.get(group.projectId);
      const open = [group, ...group.children].filter((i) => i.completedAt === null && !isHiddenParent(i));
      const soonest = open
        .flatMap((i) => {
          // An undated sub-item is planned with its dated item.
          const section = agendaSection(!i.dueDate && group.dueDate ? { ...i, dueDate: group.dueDate, dueFrom: group.dueFrom } : i, undefined, today);
          return section ? [{ section, due: i.dueDate ?? group.dueDate ?? "" }] : [];
        })
        .sort((a, b) => AGENDA_SECTIONS.indexOf(a.section) - AGENDA_SECTIONS.indexOf(b.section) || a.due.localeCompare(b.due))[0];
      return {
        section: group.completedAt === null ? (soonest?.section ?? "No date") : null,
        due: soonest?.due ?? "",
        cancelled: group.cancelled,
        node: (
          <ItemGroupView
            key={group.id}
            group={group}
            list={many ? list : undefined}
            prefix={list?.refPrefix ?? ""}
            assignees={assigneesByProject[group.projectId] ?? []}
            viewerId={viewerId}
            prLinksByItem={prLinksByItem}
            onOpenDetail={detail.openDetail}
          />
        ),
      };
    });

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto grid w-full max-w-5xl items-start gap-6 px-3 pt-6 pb-[max(0.75rem,env(safe-area-inset-bottom))] min-[900px]:grid-cols-2 min-[900px]:pt-12">
        <div className="min-w-0 space-y-2">
          <h2 className="px-1 text-xs font-medium text-neutral-500">What you’re sharing</h2>
          <DayCard
            label="Your day"
            title={myDay.within === "week" ? "Your week" : "Your day"}
            person={{ userId: viewerId, displayUsername: viewer.username, name: viewer.name, email: null, image: viewer.image }}
            sub={myDay.day ? (myDay.within === "today" ? dayName(myDay.day) : `Week of ${dayName(myDay.day)}`) : "Shared with nobody yet"}
            note={myDay.note}
            mood={myDay.mood}
            wrapUp={myDay.wrapUp}
            items={mine}
            today={myDay.today}
            groups={groups(mine, new Set(mine.map((i) => i.projectId)).size > 1, myDay.today)}
            empty={myDay.shares.length ? "Nothing of yours is due in it yet." : "Share your day and what’s due on it shows here, as they see it."}
            footer={
              <div className="space-y-1 border-t border-stone-100 px-4 py-3 dark:border-stone-800/60">
                <h3 className="pb-1 text-xs text-neutral-500">
                  {sharing ? "Who sees your day" : "Only you see this."}
                </h3>
                {myDay.shares.map((s) => (
                  <ShareRow key={s.personId} share={s} />
                ))}
                {myDay.invited.map((i) => (
                  <InvitedRow key={i.id} invitation={i} />
                ))}
                <Button
                  variant={sharing ? "ghost" : "outline"}
                  size="sm"
                  className={sharing ? "-ml-2 text-neutral-500" : ""}
                  onClick={() => onShareDay()}
                >
                  {sharing ? <Plus aria-hidden className="size-3.5" /> : <HeartHandshake aria-hidden className="size-3.5" />}
                  {sharing ? "Share with someone else" : "Share my day"}
                </Button>
              </div>
            }
          />
        </div>

        <div className="min-w-0 space-y-2">
          <h2 className="px-1 text-xs font-medium text-neutral-500">Following</h2>
          {dayShareInvites.map((d) => (
            <DayShareInviteRow key={d.personId} invite={d} />
          ))}
          {checkIns.length === 0 && dayShareInvites.length > 0 ? null : checkIns.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-stone-200 px-4 py-8 text-center text-sm text-neutral-500 dark:border-stone-800">
              Nobody shares their day with you yet. When someone does, it shows here.
            </div>
          ) : (
            <div className="space-y-4">
              {checkIns.map((c) => {
                const items = itemsOf(c);
                const span = c.within === "today" ? "day" : "week";
                return (
                  <DayCard
                    key={c.personId}
                    label={`${c.name}’s ${span}`}
                    title={`${c.name}’s ${span}`}
                    person={{ userId: c.personId, displayUsername: c.username, name: c.name, email: null, image: c.image }}
                    sub={c.within === "today" ? dayName(c.day) : `Week of ${dayName(c.day)}`}
                    menu={<StopSeeingMenu personId={c.personId} name={c.name} span={span} />}
                    note={c.note}
                    mood={c.mood}
                    wrapUp={c.wrapUp}
                    items={items}
                    today={c.today}
                    groups={groups(items, new Set(items.map((i) => i.projectId)).size > 1, c.today)}
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
          parentTitle={detail.item.parentId ? titles[detail.item.parentId] : undefined}
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

/** One day, as a card: who and when, their note and mood, progress, then to do, done and cancelled. */
function DayCard({
  label,
  title,
  person,
  sub,
  menu,
  note,
  mood,
  wrapUp,
  items,
  today,
  groups,
  empty,
  footer,
}: {
  label: string;
  title: string;
  person: { userId: string; displayUsername: string | null; name: string; email: null; image: string | null };
  sub: string;
  /** The card's ⋯ menu, for someone else's day. */
  menu?: ReactNode;
  note: string | null;
  mood: DayTag[];
  /** How the day went, once it's closed: shown under the note, never over it. */
  wrapUp: SeenWrapUp | null;
  items: Item[];
  today: string;
  /** Each item group, by the section it's in: null once it's closed, done or cancelled. */
  groups: { section: AgendaSection | null; due: string; cancelled: boolean; node: ReactNode }[];
  empty: string;
  footer: ReactNode;
}) {
  // Each of their items counts once: a top-level one, or a sub-item whose
  // item isn't in their day (shown under a stand-in, withHiddenParents).
  const ids = new Set(items.map((i) => i.id));
  const top = items.filter((i) => i.parentId === null || !ids.has(i.parentId));
  // Cancelled items are listed, but left out of progress, as on the board:
  // they weren't done, and cancelling one shouldn't keep the day from All done.
  const planned = top.filter((i) => !i.cancelled);
  const done = planned.filter((i) => i.completedAt !== null).length;
  // Each section runs by due day, ties keeping list order (as the Brief does).
  const sections = AGENDA_SECTIONS.map(
    (label) => [label, groups.filter((g) => g.section === label).sort((a, b) => a.due.localeCompare(b.due))] as const,
  ).filter(([, rows]) => rows.length > 0);
  const finished = groups.filter((g) => g.section === null && !g.cancelled);
  const cancelled = groups.filter((g) => g.section === null && g.cancelled);
  // Overdue folds away as on the Brief, for this visit only: it's their day,
  // not the viewer's to keep tidy.
  const [overdueCollapsed, setOverdueCollapsed] = useState(false);
  const overdueId = useId();
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
        {menu && <div className="ml-auto shrink-0">{menu}</div>}
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
      {wrapUp && (
        <div
          role="group"
          aria-label="How today went"
          className="space-y-2 border-b border-stone-100 px-4 py-3 dark:border-stone-800/60"
        >
          <p className="flex items-center gap-1.5 text-xs text-neutral-500">
            <CircleCheck aria-hidden className="size-3.5 text-emerald-600 dark:text-emerald-400" />
            Wrapped up at{" "}
            {new Date(wrapUp.closedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
          </p>
          {wrapUp.note && (
            <blockquote className="flex gap-2 font-serif text-[15px] leading-relaxed text-neutral-700 dark:text-neutral-300">
              <Quote aria-hidden className="mt-1 size-3.5 shrink-0 text-stone-400" />
              <span className="text-pretty">{wrapUp.note}</span>
            </blockquote>
          )}
          {wrapUp.mood.length > 0 && (
            <ul aria-label="How it went" className={`flex flex-wrap gap-1.5 ${wrapUp.note ? "pl-[22px]" : ""}`}>
              {wrapUp.mood.map((tag) => (
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
              {planned.length === 0 ? "Nothing planned yet" : done === planned.length ? "All done" : "Progress"}
            </span>
            <span className="tabular-nums text-neutral-500">
              {done} of {planned.length} done
            </span>
          </div>
          <div
            role="progressbar"
            aria-label={`${label}: progress`}
            aria-valuemin={0}
            aria-valuemax={planned.length}
            aria-valuenow={done}
            className="h-1.5 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800"
          >
            <div
              className="h-full rounded-full bg-emerald-500 transition-[width] duration-500 dark:bg-emerald-400"
              style={{ width: `${planned.length ? Math.round((done / planned.length) * 100) : 0}%` }}
            />
          </div>
        </div>
        {top.length === 0 ? (
          <p className="text-xs text-neutral-500">{empty}</p>
        ) : (
          <>
            {sections.map(([section, rows]) =>
              section === "Overdue" ? (
                <OverdueCard
                  key={section}
                  id={overdueId}
                  count={rows.length}
                  collapsed={overdueCollapsed}
                  onToggle={() => setOverdueCollapsed((c) => !c)}
                  heading="h3"
                >
                  {rows.map((g) => g.node)}
                </OverdueCard>
              ) : (
                <div key={section} className="space-y-1.5">
                  <h3 className="text-[11px] font-medium tracking-wide text-neutral-400 uppercase">
                    {/* At the weekend, what's left of the week is the weekend. */}
                    {section === "This week" && today && weekday(today) % 6 === 0 ? "This weekend" : section}
                  </h3>
                  {rows.map((g) => g.node)}
                </div>
              ),
            )}
            {finished.length > 0 && (
              <div className="space-y-1.5">
                <h3 className="text-[11px] font-medium tracking-wide text-neutral-400 uppercase">Done</h3>
                {finished.map((g) => g.node)}
              </div>
            )}
            {cancelled.length > 0 && (
              <div className="space-y-1.5">
                <h3 className="text-[11px] font-medium tracking-wide text-neutral-400 uppercase">Cancelled</h3>
                {cancelled.map((g) => g.node)}
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

/**
 * Someone invited by email to see the viewer's day, who hasn't joined yet:
 * a ⋯ menu to send it again (a new link) or cancel it. Each holds the row.
 */
export function InvitedRow({ invitation: i }: { invitation: InvitationView }) {
  const [saving, start] = useTransition();
  const save = (action: () => Promise<{ error: string } | undefined | void>, what: string, done?: string) =>
    !saving &&
    start(async () => {
      let refused: string | undefined;
      const ok = await runAction(
        action().then((r) => {
          refused = r?.error;
        }),
        what,
      );
      if (refused) toast.error(refused);
      else if (ok && done) toast.success(done);
    });
  return (
    <div
      aria-disabled={saving || undefined}
      aria-busy={saving || undefined}
      className="flex min-h-8 items-center gap-2 text-sm aria-disabled:opacity-50"
    >
      <span className="inline-flex size-[22px] shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 dark:bg-neutral-800">
        <Mail aria-hidden className="size-3" />
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate">{i.email}</span>
        <span className="block text-xs text-neutral-500">{i.expired ? "Invite expired" : "Invited, not joined yet"}</span>
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Invite to ${i.email}`}
          aria-disabled={saving || undefined}
          className="rounded p-1 text-neutral-500 hover:bg-neutral-100 aria-disabled:pointer-events-none dark:hover:bg-neutral-800"
        >
          <Ellipsis aria-hidden className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          <DropdownMenuItem onClick={() => save(() => resendInvitationAction(i.id), `send ${i.email} their invite again`, `Invite sent to ${i.email} again`)}>
            Send invite again
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => save(() => cancelInvitationAction(i.id), `cancel ${i.email}'s invite`)}>
            Cancel invite
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * Someone else's day card's ⋯ menu: stop seeing it, which ends the share
 * (they'd have to share it again). Holds the menu while it saves.
 */
function StopSeeingMenu({ personId, name, span }: { personId: string; name: string; span: string }) {
  const [saving, start] = useTransition();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${name}’s ${span} options`}
        aria-disabled={saving || undefined}
        className="rounded p-1 text-neutral-500 hover:bg-white/60 aria-disabled:pointer-events-none aria-disabled:opacity-50 dark:hover:bg-neutral-800"
      >
        <Ellipsis aria-hidden className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuItem
          variant="destructive"
          onClick={() =>
            !saving &&
            start(async () => {
              await runAction(leaveDayShareAction(personId), `stop seeing ${name}’s ${span}`);
            })
          }
        >
          Stop seeing {name}’s {span}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Someone's shared day waiting for the viewer to accept: one accept covers
 * it all, the places it adds included. Holds the row while it saves.
 */
function DayShareInviteRow({ invite: d }: { invite: DayShareInvite }) {
  const [saving, start] = useTransition();
  const span = d.within === "today" ? "day" : "week";
  const answer = (action: () => Promise<unknown>, what: string) =>
    !saving &&
    start(async () => {
      await runAction(action(), what);
    });
  return (
    <div
      role="group"
      aria-label={`${d.name}’s ${span}, waiting for you`}
      aria-disabled={saving || undefined}
      aria-busy={saving || undefined}
      className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm aria-disabled:opacity-60 dark:border-amber-900 dark:bg-amber-950/40"
    >
      <UserAvatar user={{ userId: d.personId, displayUsername: d.username, name: d.name, email: null, image: d.image }} size={28} />
      <span className="min-w-0 flex-1 basis-48 text-amber-900 dark:text-amber-200">
        <span className="font-medium">{d.name}</span> wants to share {d.within === "today" ? "today" : "this week"} with you
        {d.places.length > 0 && <span className="block text-xs opacity-80">and lets you comment on {d.places.join(", ")}</span>}
      </span>
      <div className="ml-auto flex shrink-0 gap-2">
        <Button size="sm" aria-disabled={saving || undefined} onClick={() => answer(() => acceptDayShareAction(d.personId), `accept ${d.name}’s ${span}`)}>
          Accept
        </Button>
        <Button
          size="sm"
          variant="outline"
          aria-disabled={saving || undefined}
          onClick={() => answer(() => declineDayShareAction(d.personId), `decline ${d.name}’s ${span}`)}
        >
          Decline
        </Button>
      </div>
    </div>
  );
}
