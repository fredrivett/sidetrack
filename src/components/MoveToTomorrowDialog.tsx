"use client";

import { CalendarArrowUp, CalendarCheck } from "lucide-react";
import { useState, useTransition } from "react";
import type { Item } from "@/core/schema";
import { addDays } from "@/lib/time";
import { Button } from "./ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogCloseButton,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from "./ui/responsive-dialog";
import { useItemSaves } from "./item-saves";
import { runAction } from "./run-action";

/**
 * The greeting's offer of a lighter day ("want to move some to tomorrow?"):
 * today's open items, every one set to move, and the reader taps whatever
 * has to stay today. Nothing moves until they confirm, and the dialog holds,
 * dimmed, until every new date lands. Each move is the row's own due-date
 * change, so it saves, and fails, as that does.
 */
export function MoveToTomorrowDialog({
  open,
  onOpenChange,
  items,
  today,
  contextOf,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Today's open items, in Agenda order. */
  items: Item[];
  /** The viewer's day, YYYY-MM-DD. */
  today: string;
  /** Where each one lives, such as its list or parent, shown under its title. */
  contextOf: (item: Item) => string | undefined;
}) {
  const saves = useItemSaves();
  // The ones the reader keeps for today; every other one moves.
  const [staying, setStaying] = useState<Set<string>>(new Set());
  const [saving, start] = useTransition();
  // Each offer starts with everything set to move. Reset as it opens (the
  // caller opens it), not as it closes, so the badges don't flip on the way out.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setStaying(new Set());
  }
  const moving = items.filter((i) => !staying.has(i.id));

  const change = (next: boolean) => {
    if (!saving) onOpenChange(next);
  };
  const toggle = (id: string) =>
    setStaying((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const move = () =>
    start(async () => {
      const tomorrow = addDays(today, 1);
      const moved = await Promise.all(
        moving.map((i) =>
          runAction(saves.updateItem(i.id, { dueDate: tomorrow }), `move “${i.title}” to tomorrow`),
        ),
      );
      if (moved.every(Boolean)) onOpenChange(false);
    });

  return (
    <ResponsiveDialog open={open} onOpenChange={change}>
      <ResponsiveDialogContent>
        <div className="flex shrink-0 items-start gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <div className="min-w-0 flex-1">
            <ResponsiveDialogTitle>Move to tomorrow</ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-sm text-neutral-500">
              Tap anything that has to stay today.
            </ResponsiveDialogDescription>
          </div>
          <ResponsiveDialogCloseButton className="shrink-0" />
        </div>
        <ul
          aria-busy={saving || undefined}
          className={`min-h-0 flex-1 space-y-1 overflow-y-auto px-2 py-2 transition-opacity ${saving ? "opacity-60" : ""}`}
        >
          {items.map((item) => {
            const stays = staying.has(item.id);
            const context = contextOf(item);
            const Icon = stays ? CalendarCheck : CalendarArrowUp;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  aria-pressed={!stays}
                  aria-disabled={saving || undefined}
                  onClick={() => !saving && toggle(item.id)}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left outline-none hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-neutral-300 dark:hover:bg-neutral-800 dark:focus-visible:ring-neutral-600"
                >
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate text-sm ${stays ? "text-neutral-500 dark:text-neutral-400" : "text-neutral-900 dark:text-neutral-100"}`}
                    >
                      {item.title}
                    </span>
                    {context && <span className="block truncate text-xs text-neutral-400">{context}</span>}
                  </span>
                  <span
                    className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ${
                      stays
                        ? "text-neutral-500 dark:text-neutral-400"
                        : "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                    }`}
                  >
                    <Icon aria-hidden className="size-3" />
                    {stays ? "Stays today" : "Tomorrow"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="flex shrink-0 justify-end gap-2 border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <Button variant="ghost" onClick={() => change(false)} aria-disabled={saving || undefined}>
            Keep them all
          </Button>
          <Button
            onClick={() => !saving && moving.length > 0 && move()}
            aria-disabled={saving || moving.length === 0 || undefined}
            className="aria-disabled:opacity-50"
          >
            {saving
              ? "Moving…"
              : moving.length === 0
                ? "Nothing to move"
                : `Move ${moving.length} to tomorrow`}
          </Button>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
