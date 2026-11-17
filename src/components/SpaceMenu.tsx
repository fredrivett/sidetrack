"use client";

import { Pencil } from "lucide-react";
import Link from "next/link";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { NotificationLevel } from "@/core/schema";
import { MoveMenuItems } from "./MoveMenuItems";
import { NotificationsSubmenu } from "./notification-levels";

/**
 * A tray's ⋯ menu (a Space's, or Personal's): for a Space's admin, a link to
 * its card in Spaces settings, and for anyone, moves among the board's
 * trays, as a list's menu moves it among its tray's lists. The board holds
 * the tray while a move saves (`saving`), and the menu won't open meanwhile.
 */
export function SpaceMenu({
  editId,
  name,
  prevId,
  nextId,
  firstId,
  lastId,
  saving,
  onMove,
  onSetNotifications,
}: {
  /** The Space to edit, or null when there's none the viewer may edit:
   * Personal, or a Space they're only a member of. */
  editId: string | null;
  name: string;
  prevId: string | null;
  nextId: string | null;
  firstId: string;
  lastId: string;
  saving: boolean;
  /** Moves the Space: start | end | after:<id> | before:<id>. */
  onMove: (ref: string) => void;
  /** Sets the viewer's notifications for the Space, by id; absent for Personal. */
  onSetNotifications?: { spaceId: string; set: (level: NotificationLevel | null) => void };
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
        className="relative flex size-7 shrink-0 items-center touch:after:absolute touch:after:-inset-1.5 justify-center rounded-lg text-neutral-500 hover:bg-neutral-300/50 hover:text-neutral-700 aria-disabled:opacity-50 dark:hover:bg-neutral-700/50 dark:hover:text-neutral-300"
      >
        ⋯
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {editId && (
          <>
            <DropdownMenuItem
              render={
                <Link href={`/settings/spaces#space-${editId}`}>
                  <Pencil />
                  Edit space
                </Link>
              }
            />
            <DropdownMenuSeparator />
          </>
        )}
        <MoveMenuItems
          prevId={prevId}
          nextId={nextId}
          firstId={firstId}
          lastId={lastId}
          onMove={onMove}
        />
        {onSetNotifications && (
          <>
            <DropdownMenuSeparator />
            <NotificationsSubmenu
              scope={`space:${onSetNotifications.spaceId}`}
              parent={null}
              onChoose={onSetNotifications.set}
            />
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
