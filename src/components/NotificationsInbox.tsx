"use client";

import { Bell, CheckCheck } from "lucide-react";
import { useState } from "react";
import { markNotificationsReadAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { NotificationView } from "@/core/notifications";
import { formatRelative } from "@/lib/time";
import { cn } from "@/lib/utils";
import { runAction } from "./run-action";
import { AgentAvatar, UserAvatar } from "./UserAvatar";

/**
 * The bell in the board's header: the viewer's latest notifications, with a
 * count while any is unseen. Opening it marks nothing: a notification is
 * seen once it's tapped, or with Mark all seen. Both are optimistic, like
 * ticking an item: the dot goes at once, and comes back with a toast if the
 * save fails.
 */
export function NotificationsInbox({
  open,
  onOpenChange: setOpen,
  notifications,
  onOpenNotification,
}: {
  /** Controlled by the board, so its N shortcut can open the inbox. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notifications: NotificationView[];
  /** Show what a notification is about: its item, or the board for an invite. */
  onOpenNotification: (notification: NotificationView) => void;
}) {
  // Marked seen since this page loaded, before the server says so.
  const [seen, setSeen] = useState<ReadonlySet<string>>(new Set());
  const unread = notifications.filter((n) => n.readAt === null && !seen.has(n.id));
  const isNew = (n: NotificationView) => unread.includes(n);

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

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* Hover names the bell and its N shortcut; not while the inbox is open. */}
      <Tooltip disabled={open}>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={unread.length ? `Notifications, ${unread.length} unread` : "Notifications"}
                  aria-keyshortcuts="N"
                  className="relative"
                >
                  <Bell />
                  {unread.length > 0 && (
                    <span
                      aria-hidden
                      className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] leading-none font-semibold text-white tabular-nums ring-2 ring-background"
                    >
                      {unread.length > 9 ? "9+" : unread.length}
                    </span>
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
          <h2 className="text-sm font-semibold">Notifications</h2>
          {unread.length > 0 && (
            <Button
              variant="ghost"
              size="xs"
              className="-my-1 -mr-2 text-muted-foreground"
              onClick={() => markSeen(unread.map((n) => n.id), true)}
            >
              <CheckCheck />
              Mark all seen
            </Button>
          )}
        </div>
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
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
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    if (isNew(n)) markSeen([n.id], false);
                    onOpenNotification(n);
                  }}
                  className={cn(
                    "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
                    isNew(n) && "bg-blue-50/60 dark:bg-blue-950/20",
                  )}
                >
                  {n.agentName ? (
                    <AgentAvatar agent={{ id: n.id, name: n.agentName }} size={28} className="mt-0.5" />
                  ) : n.actor ? (
                    <UserAvatar user={n.actor} size={28} className="mt-0.5" />
                  ) : (
                    <span className="mt-0.5 size-7 shrink-0 rounded-full bg-muted" />
                  )}
                  <span className="min-w-0 flex-1 space-y-1">
                    <span
                      className={cn(
                        "block text-sm leading-snug break-words",
                        !isNew(n) && "text-foreground/75",
                      )}
                    >
                      {isNew(n) && <span className="sr-only">New: </span>}
                      {/* Who and what stand out; the words between them don't. */}
                      {n.parts.map((part, i) =>
                        part.em ? (
                          <strong key={i} className="font-semibold">
                            {part.text}
                          </strong>
                        ) : (
                          part.text
                        ),
                      )}
                    </span>
                    {n.snippet && (
                      <span className="line-clamp-2 border-l-2 border-border pl-2 text-xs text-muted-foreground">
                        {n.snippet}
                      </span>
                    )}
                    <span className="block text-xs text-muted-foreground">
                      {n.title} · {formatRelative(n.createdAt)}
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      "mt-2 size-2 shrink-0 rounded-full",
                      isNew(n) ? "bg-blue-500" : "bg-transparent",
                    )}
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
