"use client";

import { useEffect, useState } from "react";
import { setAgendaReadAction } from "@/app/actions";
import type { Greeting } from "@/core/agendaGreeting";
import type { Item } from "@/core/schema";
import { parseGreeting } from "@/lib/greeting";

const READ_MS = 2000;

/**
 * The few calm sentences at the top of the Agenda. Items it names are chips
 * that open them; an action phrase does what it says. Leaving it, by
 * switching view or tab, counts as having read it, so the next greeting
 * looks back from then. The greeting stays as first shown while the Agenda
 * is open: the board reloads on every change, and a later one, written
 * after a stamp, would drop the look-back from under the reader.
 */
export function AgendaGreeting({
  greeting,
  itemsById,
  onOpenItem,
  onAction,
}: {
  greeting: Greeting;
  /** Items the page has, so a chip can open its item. */
  itemsById: Map<string, Item>;
  onOpenItem: (item: Item) => void;
  onAction: (action: string) => void;
}) {
  const [shown] = useState(greeting);
  useEffect(() => {
    // When it came into view; a glance of under READ_MS isn't a read (and
    // nor is React's dev-only remount).
    let shownAt = document.visibilityState === "visible" ? Date.now() : null;
    const leave = () => {
      if (shownAt !== null && Date.now() - shownAt >= READ_MS) void setAgendaReadAction();
      shownAt = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") shownAt ??= Date.now();
      else leave();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      leave();
    };
  }, []);

  return (
    <p className="px-1 pt-2 pb-1 text-[15px] leading-7 text-neutral-600 text-pretty dark:text-neutral-300">
      {parseGreeting(shown.text).map((part, i) => {
        // "Others" opens the rest of No date once the Agenda can show them.
        if (part.kind === "text" || part.kind === "others") return part.text;
        if (part.kind === "action") {
          return (
            <button
              key={i}
              type="button"
              onClick={() => onAction(part.action)}
              className="rounded-sm text-neutral-900 underline decoration-neutral-300 underline-offset-4 outline-none hover:decoration-neutral-500 focus-visible:ring-2 focus-visible:ring-neutral-300 dark:text-neutral-100 dark:decoration-neutral-600 dark:hover:decoration-neutral-400 dark:focus-visible:ring-neutral-600"
            >
              {part.text}
            </button>
          );
        }
        const item = itemsById.get(part.id);
        const title = item?.title ?? shown.titles[part.id] ?? "";
        const chip =
          "rounded-md bg-neutral-100 px-1 py-px leading-normal text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100";
        // An item the page hasn't loaded, such as one finished days ago, is named but can't open.
        return item ? (
          <button
            key={i}
            type="button"
            onClick={() => onOpenItem(item)}
            className={`${chip} outline-none hover:bg-neutral-200 focus-visible:ring-2 focus-visible:ring-neutral-300 dark:hover:bg-neutral-700 dark:focus-visible:ring-neutral-600`}
          >
            {title}
          </button>
        ) : (
          <span key={i} className={chip}>
            {title}
          </span>
        );
      })}
    </p>
  );
}
