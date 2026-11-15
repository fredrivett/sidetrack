"use client";

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
    <button
      type="button"
      onClick={onClick}
      className="flex h-full min-h-32 w-72 shrink-0 snap-center flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-neutral-300 text-sm font-medium text-neutral-500 transition-colors hover:border-neutral-400 hover:text-neutral-700 dark:border-neutral-700 dark:hover:border-neutral-500 dark:hover:text-neutral-300"
    >
      + Add list
      {shortcut && (
        <KbdGroup>
          <Kbd>⇧</Kbd>
          <Kbd>C</Kbd>
        </KbdGroup>
      )}
    </button>
  );
}
