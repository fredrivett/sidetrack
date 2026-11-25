"use client";

import { Bell, CalendarClock, Check, CheckCheck, Circle, CircleCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { markNotificationsReadAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { NotificationView } from "@/core/notifications";
import { formatRelative } from "@/lib/time";
import { cn } from "@/lib/utils";
import { DueBadge } from "./DueBadge";
import { runAction } from "./run-action";
import { ProjectIcon } from "./ProjectIcon";
import { Reactions } from "./Reactions";
import { AgentAvatar, UserAvatar } from "./UserAvatar";

/**
 * The bell in the board's header: the viewer's latest notifications, with a
 * count while any is unseen. Opening it marks nothing: a notification is
 * seen once it's tapped, with its dot, or with Mark all seen. All are optimistic, like
 * ticking an item: the dot goes at once, and comes back with a toast if the
 * save fails.
 */
export function NotificationsInbox({
  open,
  onOpenChange: setOpen,
  notifications,
  onOpenNotification,
  onOpenList,
  viewerId,
}: {
  /** Controlled by the board, so its N shortcut can open the inbox. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notifications: NotificationView[];
  /** Show what a notification is about: its item, or the board for an invite. */
  onOpenNotification: (notification: NotificationView) => void;
  /** Show a list a notification names. */
  onOpenList: (listId: string) => void;
  viewerId: string;
}) {
  // Marked seen since this page loaded, before the server says so.
  const [seen, setSeen] = useState<ReadonlySet<string>>(new Set());
  const unread = notifications.filter((n) => n.readAt === null && !seen.has(n.id));
  const isNew = (n: NotificationView) => unread.includes(n);

  // The Home Screen icon's badge follows the count here, as pushes set it
  // while the app is closed (public/sw.js).
  const count = unread.length;
  useEffect(() => {
    if (!("setAppBadge" in navigator)) return;
    (count ? navigator.setAppBadge(count) : navigator.clearAppBadge()).catch(() => {});
  }, [count]);

  function markSeen(ids: string[], all: boolean) {
    if (ids.length === 0) return;
    setSeen((s) => new Set([...s, ...ids]));
    void runAction(
      markNotificationsReadAction(all ? undefined : ids),
      all ? "mark your notifications seen" : "mark that notification seen",
    ).then((ok) => {
      if (ok) return;
      setSeen((s) => new Set([...s].filter((id) => !ids.includes(id))));
    });
  }

  function openList(n: NotificationView, listId: string) {
    setOpen(false);
    if (isNew(n)) markSeen([n.id], false);
    onOpenList(listId);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* Hover names the bell and its N shortcut; not while the inbox is open. */}
      <Tooltip disabled={open}>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                // Quiet, like the header's other icons, until something's
                // unseen: then it's filled, with a dot on the bell. The count
                // is in its label and inside, not on it.
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={unread.length ? `Notifications, ${unread.length} unread` : "Notifications"}
                  aria-keyshortcuts="N"
                  className={cn(
                    "relative",
                    unread.length > 0 ? "bg-muted text-foreground dark:bg-muted/50" : "text-muted-foreground",
                  )}
                >
                  <Bell />
                  {unread.length > 0 && (
                    <span
                      aria-hidden
                      className="absolute top-1 right-1.5 size-2 rounded-full bg-red-500 ring-2 ring-background touch:top-1.5 touch:right-2"
                    />
                  )}
                </Button>
              }
            />
          }
        />
        <TooltipContent side="bottom">
          Notifications <Kbd>N</Kbd>
        </TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-[22rem] max-w-[calc(100vw-1rem)] p-0">
        <div className="flex items-baseline justify-between border-b border-border px-4 py-2.5">
          <h2 data-replay-safe className="text-sm font-semibold">Notifications</h2>
          {unread.length > 0 && (
            <Button
              variant="ghost"
              size="xs"
              className="-my-1 -mr-2 text-muted-foreground"
              data-replay-safe
              onClick={() => markSeen(unread.map((n) => n.id), true)}
            >
              <CheckCheck />
              Mark all seen
            </Button>
          )}
        </div>
        {notifications.length === 0 ? (
          <div data-replay-safe className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Bell className="size-5" />
            </span>
            <p className="text-sm font-medium">You&apos;re all caught up</p>
            <p className="text-xs text-muted-foreground">
              When someone assigns you, mentions you or invites you, it shows here.
            </p>
          </div>
        ) : (
          <ul className="max-h-[min(40rem,calc(var(--available-height)-3rem))] divide-y divide-border/60 overflow-y-auto">
            {notifications.map((n) => (
              <li
                key={n.id}
                // ⌘. copies its item's ref while hovered (CopyHoveredItemRef).
                data-item-ref={n.itemRef}
                // The row's button covers it, under the list chips, which are
                // buttons of their own; the row shows its hover and focus.
                // Its background is opaque and named, for the dot's outline.
                className={cn(
                  "group/row relative flex w-full items-start gap-3 bg-(--row-bg) px-4 py-3 text-left transition-colors hover:[--row-bg:var(--color-muted)] has-[>button:focus-visible]:[--row-bg:var(--color-muted)]",
                  isNew(n)
                    ? "[--row-bg:color-mix(in_oklab,var(--color-blue-50)_60%,var(--color-popover))] dark:[--row-bg:color-mix(in_oklab,var(--color-blue-950)_20%,var(--color-popover))]"
                    : "[--row-bg:var(--color-popover)]",
                )}
              >
                <button
                  type="button"
                  aria-labelledby={`notification-${n.id}`}
                  onClick={() => {
                    setOpen(false);
                    if (isNew(n)) markSeen([n.id], false);
                    onOpenNotification(n);
                  }}
                  className="absolute inset-0 focus-visible:outline-none"
                />
                {n.agentName ? (
                  <AgentAvatar agent={{ id: n.id, name: n.agentName }} size={28} className="mt-0.5" />
                ) : n.actor ? (
                  <UserAvatar user={n.actor} size={28} className="mt-0.5" />
                ) : n.reason === "due-today" || n.reason === "overdue" ? (
                  <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <CalendarClock className="size-4" />
                  </span>
                ) : (
                  <span className="mt-0.5 size-7 shrink-0 rounded-full bg-muted" />
                )}
                <span className="min-w-0 flex-1 space-y-1">
                  <span
                    id={`notification-${n.id}`}
                    className={cn(
                      "block text-sm leading-snug break-words",
                      !isNew(n) && "text-foreground/75",
                    )}
                  >
                    {isNew(n) && <span className="sr-only">New: </span>}
                    {/* Who and what stand out; the words between them don't.
                        A list shows as itself, icon and all, and opens. */}
                    {n.parts.map((part, i) => {
                      const list = part.list;
                      return list ? (
                        <ListChip key={i} list={list} name={part.text} onOpen={() => openList(n, list.id)} />
                      ) : part.due ? (
                        <DueBadge key={i} due={part.due.dueDate} from={part.due.dueFrom} done />
                      ) : part.em === "item" ? (
                        <ItemName key={i} name={part.text} done={part.done} />
                      ) : part.em ? (
                        <strong key={i} className="font-semibold">
                          {part.text}
                        </strong>
                      ) : (
                        part.text
                      );
                    })}
                  </span>
                  {n.snippet && (
                    <span className="line-clamp-2 border-l-2 border-border pl-2 text-xs text-muted-foreground">
                      {n.snippet}
                    </span>
                  )}
                  {/* Above the row's button, like the list chips, so a tap
                      reacts rather than opens the item. */}
                  {n.reactTo && (
                    <Reactions
                      target={n.reactTo}
                      reactions={n.reactions ?? []}
                      viewerId={viewerId}
                      className="relative z-10 pt-0.5"
                    />
                  )}
                  <span className="flex items-center text-xs text-muted-foreground">
                    {/* Where, unless the sentence already shows the list. */}
                    {n.parts.some((part) => part.list && part.list.id === n.list?.id) ? null : (
                      <>
                        {n.list ? (
                          <ListChip
                            small
                            list={n.list}
                            name={n.title}
                            onOpen={() => n.list && openList(n, n.list.id)}
                          />
                        ) : (
                          <span className="truncate">{n.title}</span>
                        )}
                        <span
                          aria-hidden
                          className="mx-1.5 text-[10px] leading-none"
                        >
                          •
                        </span>
                      </>
                    )}
                    <span className="shrink-0">{formatRelative(n.createdAt)}</span>
                  </span>
                </span>
                {/* The dot is the button. Hovering the row grows it a little,
                    a hint; hovering or focusing it stretches it left into a
                    pill that says what it does, over the text, never moving
                    it; a ring of the row's background cuts it out of the text.
                    Its button reaches past it, so the dot is easy to hit. */}
                <span className="relative mt-2 size-2 shrink-0">
                  {isNew(n) && (
                    <button
                      type="button"
                      aria-label="Mark seen"
                      onClick={() => markSeen([n.id], false)}
                      className="group/seen absolute top-1/2 -right-2.5 z-10 flex w-max -translate-y-1/2 p-2.5 focus-visible:outline-none"
                    >
                      <span className="flex h-2 min-w-2 items-center justify-end rounded-full bg-blue-500 text-xs font-medium text-white transition-[height,min-width,padding,background-color,box-shadow] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] group-hover/seen:duration-350 group-focus-visible/seen:duration-350 group-hover/row:h-2.75 group-hover/row:min-w-2.75 ring-3 ring-(--row-bg) group-hover/seen:h-6! group-hover/seen:bg-blue-600 group-hover/seen:px-2.5 group-focus-visible/seen:h-6! group-focus-visible/seen:bg-blue-600 group-focus-visible/seen:px-2.5 group-focus-visible/seen:outline-2 group-focus-visible/seen:outline-offset-3 group-focus-visible/seen:outline-ring motion-reduce:transition-none">
                        <span
                          aria-hidden
                          className="grid grid-cols-[0fr] transition-[grid-template-columns] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] group-hover/seen:grid-cols-[1fr] group-hover/seen:duration-350 group-focus-visible/seen:grid-cols-[1fr] group-focus-visible/seen:duration-350 motion-reduce:transition-none"
                        >
                          {/* The words fade in once there's room for them, and out first. */}
                          <span className="flex items-center gap-1 overflow-hidden whitespace-nowrap opacity-0 transition-opacity duration-100 group-hover/seen:opacity-100 group-hover/seen:delay-100 group-hover/seen:duration-250 group-focus-visible/seen:opacity-100 group-focus-visible/seen:delay-100 group-focus-visible/seen:duration-250 motion-reduce:transition-none">
                            Mark seen
                            <Check className="size-3.5 shrink-0" strokeWidth={2.5} />
                          </span>
                        </span>
                      </span>
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * An item a notification names, drawn as an item: its circle, ticked when
 * done, then its title. The title underlines while the row is hovered or
 * focused, as the row is what opens it, but not while a list chip is. The circle keeps to the first word,
 * so a wrapped title never leaves it alone at a line's end.
 */
function ItemName({ name, done }: { name: string; done?: boolean }) {
  const Icon = done ? CircleCheck : Circle;
  const space = name.search(/\s/);
  const [first, rest] = space < 0 ? [name, ""] : [name.slice(0, space), name.slice(space)];
  const underline =
    "underline decoration-transparent underline-offset-2 transition-colors group-hover/row:decoration-current group-has-[>button:focus-visible]/row:decoration-current group-has-[[data-list-chip]:hover]/row:decoration-transparent";
  return (
    <span className={cn("font-medium", done ? "text-muted-foreground" : "text-foreground")}>
      <span className="whitespace-nowrap">
        <Icon
          aria-hidden
          className={cn(
            "mr-1 inline size-[0.95em] align-[-0.15em]",
            done ? "text-green-600 dark:text-green-500" : "text-muted-foreground",
          )}
          strokeWidth={2.25}
        />
        {done && <span className="sr-only">done: </span>}
        <span className={underline}>
          {first}
        </span>
      </span>
      {rest && (
        <span className={underline}>
          {rest}
        </span>
      )}
    </span>
  );
}

/**
 * A list a notification names: its icon (none rather than a letter) and
 * name, opening the list. Above the row's own button, which covers the row,
 * so it underlines on its own hover. Muted in the line under the sentence.
 */
function ListChip({
  list,
  name,
  small,
  onOpen,
}: {
  list: NonNullable<NotificationView["list"]>;
  name: string;
  small?: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      // Hovering it underlines only it, not the row's item (ItemName).
      data-list-chip
      onClick={onOpen}
      className={cn(
        "relative z-10 inline-flex max-w-full items-baseline gap-1 rounded-sm align-baseline underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring",
        small ? "min-w-0 text-muted-foreground hover:text-foreground" : "font-semibold text-foreground",
      )}
    >
      <ProjectIcon
        icon={list.icon}
        homepageUrl={list.homepageUrl}
        name={name}
        size={small ? 12 : 13}
        className="self-center"
        // A letter in a chip reads as part of the name.
        letter={false}
      />
      <span className="truncate">{name}</span>
    </button>
  );
}
