"use client";

import { SmilePlus } from "lucide-react";
import { useRef, useState } from "react";
import { toggleReactionAction } from "@/app/actions";
import {
  EmojiPicker,
  EmojiPickerContent,
  EmojiPickerSearch,
} from "@/components/ui/emoji-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ReactionRef, ReactionView } from "@/core/reactions";
import { cn } from "@/lib/utils";
import { runAction } from "./run-action";

/** The quick picks, ahead of the full picker. */
const QUICK = ["🎉", "👍", "❤️", "🙌", "😂", "👀"];

/** "Fred, Sam and 2 others". */
function whoWords(people: ReactionView["people"], viewerId: string): string {
  const names = people.map((p) => (p.userId === viewerId ? "You" : p.name));
  if (names.length <= 3) return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} others`;
}

/** `views` with the viewer's `emoji` added or taken away. */
function toggled(views: ReactionView[], emoji: string, viewer: { userId: string; name: string }): ReactionView[] {
  const at = views.findIndex((v) => v.emoji === emoji);
  if (at === -1) return [...views, { emoji, people: [viewer], mine: true }];
  const v = views[at];
  const people = v.mine ? v.people.filter((p) => p.userId !== viewer.userId) : [...v.people, viewer];
  const next = { ...v, people, mine: !v.mine };
  return people.length ? views.with(at, next) : views.toSpliced(at, 1);
}

/**
 * The reactions on something, one chip per emoji with its count, and a
 * button to add one. Optimistic, like ticking an item: a tap shows at once,
 * and comes back with a toast if the save fails. Tapping your own takes it
 * back. Read-only (`canReact` false) shows the chips without the button.
 */
export function Reactions({
  target,
  reactions,
  viewerId,
  canReact = true,
  quiet = false,
  className,
}: {
  target: ReactionRef;
  reactions: ReactionView[];
  viewerId: string;
  canReact?: boolean;
  /** With no reactions yet, the button waits at the top right of the row
   * (a `relative group/reactable`) until it's hovered or focused; always
   * there on touch. */
  quiet?: boolean;
  className?: string;
}) {
  const [views, setViews] = useState(reactions);
  // A newer read from the server (a reload, a live update) replaces ours.
  const [prev, setPrev] = useState(reactions);
  if (prev !== reactions) {
    setPrev(reactions);
    setViews(reactions);
  }
  const [open, setOpen] = useState(false);
  // Only the latest save's answer counts: an earlier one may land after it.
  const latest = useRef(0);

  function toggle(emoji: string) {
    if (!canReact) return;
    setOpen(false);
    const before = views;
    setViews(toggled(views, emoji, { userId: viewerId, name: "You" }));
    const n = ++latest.current;
    void runAction(
      toggleReactionAction(target, emoji).then((saved) => {
        if (n === latest.current) setViews(saved);
      }),
      "save your reaction",
    ).then((ok) => {
      if (!ok && n === latest.current) setViews(before);
    });
  }

  if (views.length === 0 && !canReact) return null;
  const waits = quiet && views.length === 0;
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1",
        // Floats at the row's top right (it's `relative`), so showing it moves nothing.
        waits && "absolute top-0 right-0 mt-0!",
        className,
      )}
    >
      {views.map((v) => (
        <Tooltip key={v.emoji}>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-pressed={v.mine}
                aria-label={`${v.emoji} ${v.people.length}: ${whoWords(v.people, viewerId)}`}
                onClick={() => toggle(v.emoji)}
                aria-disabled={!canReact || undefined}
                className={cn(
                  "inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs tabular-nums ring-1 transition-colors",
                  v.mine
                    ? "bg-blue-50 text-blue-800 ring-blue-300 hover:bg-blue-100 dark:bg-blue-950/60 dark:text-blue-200 dark:ring-blue-800"
                    : "bg-background text-muted-foreground ring-border hover:bg-muted",
                  !canReact && "pointer-events-none",
                )}
              >
                <span className="text-sm leading-none">{v.emoji}</span>
                {v.people.length}
              </button>
            }
          />
          <TooltipContent>{whoWords(v.people, viewerId)}</TooltipContent>
        </Tooltip>
      ))}
      {canReact && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            aria-label="React"
            className={cn(
              "inline-flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring data-popup-open:bg-muted data-popup-open:text-foreground",
              waits &&
                "opacity-0 group-hover/reactable:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100 [@media(hover:none)]:opacity-100",
            )}
          >
            <SmilePlus className="size-4" />
          </PopoverTrigger>
          <PopoverContent
            // The quick reactions and the emoji grid are what's pressed: its
            // search is for the odd one, and a phone's keyboard would cover it.
            initialFocus={null}
            align="start"
            className="w-72 p-0"
          >
            <div className="flex justify-between border-b p-1.5">
              {QUICK.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  aria-label={`React ${emoji}`}
                  onClick={() => toggle(emoji)}
                  className="flex size-9 items-center justify-center rounded-md text-xl hover:bg-muted"
                >
                  {emoji}
                </button>
              ))}
            </div>
            <EmojiPicker className="h-[260px] w-full" onEmojiSelect={({ emoji }) => toggle(emoji)}>
              <EmojiPickerSearch placeholder="Search emoji…" className="h-7 border-0 px-1" />
              <EmojiPickerContent />
            </EmojiPicker>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
