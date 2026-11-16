"use client";

import { ArrowLeft, ArrowLeftToLine, ArrowRight, ArrowRightToLine } from "lucide-react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

/**
 * Move to start / left / right / to end, for the menu of something in a row:
 * a list among its tray's lists, or a tray among the board's. `onMove` gets
 * the ref to move it to: before:<id> or after:<id> a neighbour or an end.
 */
export function MoveMenuItems({
  prevId,
  nextId,
  firstId,
  lastId,
  onMove,
}: {
  prevId: string | null;
  nextId: string | null;
  firstId: string;
  lastId: string;
  onMove: (ref: string) => void;
}) {
  return (
    <>
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
    </>
  );
}
