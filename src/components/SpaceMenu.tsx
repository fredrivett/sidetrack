"use client";

import { ArrowLeft, ArrowLeftToLine, ArrowRight, ArrowRightToLine } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * A tray's ⋯ menu (a Space's, or Personal's): its moves among the board's
 * trays, as a list's menu moves it among its tray's lists. The board holds the
 * tray while a move saves (`saving`), and the menu won't open meanwhile.
 */
export function SpaceMenu({
  name,
  prevId,
  nextId,
  firstId,
  lastId,
  saving,
  onMove,
}: {
  name: string;
  prevId: string | null;
  nextId: string | null;
  firstId: string;
  lastId: string;
  saving: boolean;
  /** Moves the Space: start | end | after:<id> | before:<id>. */
  onMove: (ref: string) => void;
}) {
  return (
    <DropdownMenu
      // aria-disabled rather than disabled while saving, so the trigger the
      // closing menu hands focus back to keeps it; it just won't open.
      onOpenChange={(open, details) => open && saving && details.cancel()}
    >
      <DropdownMenuTrigger
        aria-label={`${name} options`}
        aria-disabled={saving || undefined}
        className="flex size-7 shrink-0 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-300/50 hover:text-neutral-700 aria-disabled:opacity-50 dark:hover:bg-neutral-700/50 dark:hover:text-neutral-300"
      >
        ⋯
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem disabled={!prevId} onClick={() => onMove(`before:${firstId}`)}>
          <ArrowLeftToLine />
          Move to start
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!prevId} onClick={() => onMove(`before:${prevId}`)}>
          <ArrowLeft />
          Move left
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!nextId} onClick={() => onMove(`after:${nextId}`)}>
          <ArrowRight />
          Move right
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!nextId} onClick={() => onMove(`after:${lastId}`)}>
          <ArrowRightToLine />
          Move to end
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
