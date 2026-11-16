"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";

export function AddProjectButton({
  onClick,
  shortcut = true,
}: {
  onClick: () => void;
  /** ⇧C adds a list outside any Space, so an empty Space's button leaves it off. */
  shortcut?: boolean;
}) {
  return (
    // The whole column is a pointer target; the button inside is the keyboard
    // one, and its click bubbles up to here.
    <div
      onClick={onClick}
      className="group/add-list flex h-full min-h-32 w-72 shrink-0 cursor-pointer snap-center flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-neutral-300 transition-colors hover:border-neutral-400 dark:border-neutral-700 dark:hover:border-neutral-500"
    >
      {/* The same button as an empty list's Add item, in its hover state while
          the column is hovered. */}
      <Button
        variant="outline"
        size="xs"
        className="dark:bg-neutral-900 group-hover/add-list:bg-muted group-hover/add-list:text-foreground dark:group-hover/add-list:bg-neutral-800"
      >
        <Plus />
        Add list
      </Button>
      {shortcut && (
        <KbdGroup>
          <Kbd>⇧</Kbd>
          <Kbd>C</Kbd>
        </KbdGroup>
      )}
    </div>
  );
}
