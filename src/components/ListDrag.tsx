"use client";

import { type Active, getClientRect, useDndMonitor, useDraggable } from "@dnd-kit/core";
import { getEventCoordinates } from "@dnd-kit/utilities";
import { ArrowRight, Boxes, LogOut, TriangleAlert, User, UserMinus, UserPlus, Users } from "lucide-react";
import { type ComponentProps, type ReactNode, useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { listMembersAction, listSpaceMembersAction } from "@/app/actions";
import type { SpaceColor, SpaceRole } from "@/core/schema";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import { LoadingEllipsis } from "@/components/ui/loading-ellipsis";
import {
  ResponsiveDialog,
  ResponsiveDialogCloseButton,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { ColumnCard } from "./BoardLayout";
import { columnEl, LIST_SOURCE, useBoardDrag } from "./BoardDrag";
import { ProjectIcon } from "./ProjectIcon";
import { runAction } from "./run-action";
import { spaceSwatch, spaceTint } from "./SpaceColor";
import { assigneeName, type AvatarUser, UserAvatar } from "./UserAvatar";
import type { ListMove } from "./use-list-saves";

// Dragging a whole list by its header: along its tray to reorder it, or
// onto another Space's tray to move it there, which asks first. The list's
// column stays behind as the empty slot it would drop into, moving through
// the board as it's dragged while the other lists slide aside, and a copy
// of it follows the pointer. Mouse and touch only: from the keyboard, it's
// the list menu's Move and Move to Space.

const EASING = "cubic-bezier(0.25, 1, 0.5, 1)";
const LIFTED = "0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)";
const COLUMN = "column:";

const isList = (active: Active) => active.data.current?.home === LIST_SOURCE;
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const columnsIn = (root: ParentNode) => [
  ...root.querySelectorAll<HTMLElement>("[data-project-id]"),
];

/**
 * Makes `change` (a re-render that moves columns) slide the board's columns
 * from where they were to where it puts them.
 */
export function flipColumns(change: () => void) {
  const before = new Map(columnsIn(document).map((el) => [el, el.getBoundingClientRect()]));
  flushSync(change);
  if (reducedMotion()) return;
  for (const el of columnsIn(document)) {
    const was = before.get(el);
    if (!was) continue;
    for (const a of el.getAnimations()) a.cancel();
    const now = el.getBoundingClientRect();
    const dx = was.left - now.left;
    const dy = was.top - now.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], {
      duration: 250,
      easing: EASING,
    });
  }
}

// Renaming the list in its header, typing or selecting, isn't a drag.
// Nor is a press in one of its popups (the icon picker, the ⋯ menu), which
// are portaled out of the header but still bubble through it in React.
const inField = (e: { target: EventTarget; currentTarget: Element }) =>
  !e.currentTarget.contains(e.target as Node) ||
  (e.target as Element).closest?.("input, textarea, [contenteditable]") != null;

/** A list's column, dragged by its header unless `draggable` is false. */
export function DraggableColumnCard({
  projectId,
  draggable,
  ...props
}: ComponentProps<typeof ColumnCard> & { projectId: string; draggable: boolean }) {
  const { listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: `${COLUMN}${projectId}`,
    data: { home: LIST_SOURCE },
    disabled: !draggable,
  });
  return (
    <ColumnCard
      ref={setNodeRef}
      data-placeholder={isDragging || undefined}
      headerProps={
        draggable && listeners
          ? {
              ref: setActivatorNodeRef,
              onMouseDown: (e) => !inField(e) && listeners.onMouseDown?.(e),
              onTouchStart: (e) => !inField(e) && listeners.onTouchStart?.(e),
            }
          : undefined
      }
      {...props}
    />
  );
}

interface Dragging {
  id: string;
  /** The tray it started on. */
  from: string;
  rail: HTMLElement;
  clone: HTMLElement;
  /** The column's box, and the pointer's x, when it was picked up. */
  rect: DOMRect;
  startX: number;
  x: number;
  /** Where it would drop now, and where it started, as tray|ref. */
  key: string;
  startKey: string;
  move: ListMove;
  stop: () => void;
}

/**
 * Follows drags of the board's lists (DraggableColumnCard): shows the list
 * where it would drop as it's dragged (`onPreview`), and says where it was
 * dropped (`onDrop`, null for where it started). Lists go only onto trays
 * `canDrop` allows.
 */
export function ListDragging({
  nameOf,
  canDrop,
  onPreview,
  onDrop,
}: {
  nameOf: (listId: string) => string;
  canDrop: (listId: string, trayId: string) => boolean;
  onPreview: (move: ListMove) => void;
  onDrop: (move: ListMove | null) => void;
}) {
  const board = useBoardDrag();
  const props = useRef({ nameOf, canDrop, onPreview, onDrop });
  useLayoutEffect(() => {
    props.current = { nameOf, canDrop, onPreview, onDrop };
  });
  const drag = useRef<Dragging | null>(null);
  // Gone mid-drag (a view switch): stop following the pointer, and take the
  // card in hand off the page.
  useEffect(
    () => () => {
      drag.current?.stop();
      drag.current?.clone.remove();
      drag.current = null;
    },
    [],
  );

  const name = (active: Active) => props.current.nameOf(String(active.id).slice(COLUMN.length));
  useLayoutEffect(() =>
    board.register(LIST_SOURCE, {
      coordinateGetter: () => undefined,
      announcements: {
        onDragStart: ({ active }) => `Picked up the list “${name(active)}”.`,
        onDragOver: () => undefined,
        onDragEnd: ({ active }) => `Dropped the list “${name(active)}”.`,
        onDragCancel: ({ active }) => `Put the list “${name(active)}” back.`,
      },
    }),
  );

  // The trays on the board, or the board itself without Spaces.
  const trays = (rail: HTMLElement) => {
    const sections = [...rail.querySelectorAll<HTMLElement>("[data-tray-id]")];
    return sections.length
      ? sections.map((el) => ({ id: el.dataset.trayId ?? "", el }))
      : [{ id: "personal", el: rail }];
  };

  // Where the card in hand would drop: on the tray under its middle, before
  // the first list there whose middle is right of its own.
  function spot(d: Pick<Dragging, "id" | "from" | "rail" | "rect" | "startX" | "x">) {
    const middle = d.rect.left + d.x - d.startX + d.rect.width / 2;
    const tray = trays(d.rail).find((t) => {
      const r = t.el.getBoundingClientRect();
      return middle >= r.left && middle <= r.right;
    });
    if (!tray || !props.current.canDrop(d.id, tray.id)) return null;
    const others = columnsIn(tray.el).filter((el) => el.dataset.projectId !== d.id);
    // Where they're laid out, not where they're sliding through.
    const at = others.filter((el) => {
      const r = getClientRect(el, { ignoreTransform: true });
      return r.left + r.width / 2 < middle;
    }).length;
    const ref = others[at]
      ? `before:${others[at].dataset.projectId}`
      : others.length
        ? `after:${others[others.length - 1].dataset.projectId}`
        : null;
    const move: ListMove = {
      id: d.id,
      ref,
      ...(tray.id !== d.from && { spaceId: tray.id === "personal" ? null : tray.id }),
    };
    return { key: `${tray.id}|${ref}`, move };
  }

  function follow() {
    const d = drag.current;
    if (!d) return;
    d.clone.style.translate = `${d.x - d.startX}px 0`;
    const next = spot(d);
    if (!next || next.key === d.key) return;
    d.key = next.key;
    d.move = next.move;
    flipColumns(() => props.current.onPreview(next.move));
    navigator.vibrate?.(8);
  }

  function start(active: Active, activatorEvent: Event | null) {
    const id = String(active.id).slice(COLUMN.length);
    const el = columnEl(id);
    const rail = el?.closest<HTMLElement>(".kanban-rail");
    if (!el || !rail) return;
    const rect = el.getBoundingClientRect();
    const startX = (activatorEvent && getEventCoordinates(activatorEvent)?.x) ?? rect.left;

    // The card in hand: a copy of the column, lifted off the board.
    const clone = el.cloneNode(true) as HTMLElement;
    for (const attr of ["data-project-id", "data-placeholder", "aria-busy"]) clone.removeAttribute(attr);
    for (const row of clone.querySelectorAll("[data-item-row], [data-row-id]")) {
      row.removeAttribute("data-item-row");
      row.removeAttribute("data-row-id");
    }
    clone.setAttribute("aria-hidden", "true");
    clone.classList.add("cursor-grabbing", "**:cursor-grabbing!");
    Object.assign(clone.style, {
      position: "fixed",
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      margin: "0",
      zIndex: "999",
      visibility: "",
      pointerEvents: "none",
      opacity: "1",
      transition: "scale 150ms ease-out, box-shadow 150ms ease-out",
    });
    document.body.append(clone);
    const scroll = el.querySelector("[data-column-scroll]");
    const copied = clone.querySelector("[data-column-scroll]");
    if (scroll && copied) copied.scrollTop = scroll.scrollTop;
    requestAnimationFrame(() => {
      clone.style.boxShadow = LIFTED;
      if (!reducedMotion()) clone.style.scale = "1.03";
    });

    const from = el.closest<HTMLElement>("[data-tray-id]")?.dataset.trayId ?? "personal";
    const here = { id, from, rail, rect, startX, x: startX };
    const startKey = spot(here)?.key ?? "";

    // The pointer, ahead of dnd-kit's own listeners (capture).
    const onMove = (e: PointerEvent | TouchEvent) => {
      const x = getEventCoordinates(e)?.x;
      if (x === undefined || !drag.current) return;
      drag.current.x = x;
      follow();
    };
    // Near the board's edges, it scrolls; the slot follows (on scroll).
    let frame = 0;
    const edgeScroll = () => {
      const d = drag.current;
      if (d) {
        const r = rail.getBoundingClientRect();
        const edge = Math.min(80, r.width / 4);
        const into = Math.max(r.left + edge - d.x, d.x - (r.right - edge));
        if (into > 0) rail.scrollLeft += Math.sign(d.x - (r.left + r.width / 2)) * Math.min(into, edge) / 3;
      }
      frame = requestAnimationFrame(edgeScroll);
    };
    frame = requestAnimationFrame(edgeScroll);
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("touchmove", onMove, true);
    rail.addEventListener("scroll", follow);
    // The board stops snapping to columns, so it can scroll smoothly under the card.
    rail.style.scrollSnapType = "none";

    drag.current = {
      ...here,
      clone,
      key: startKey,
      startKey,
      move: { id, ref: null },
      stop: () => {
        cancelAnimationFrame(frame);
        window.removeEventListener("pointermove", onMove, true);
        window.removeEventListener("touchmove", onMove, true);
        rail.removeEventListener("scroll", follow);
        rail.style.scrollSnapType = "";
      },
    };
    navigator.vibrate?.(10);
  }

  // The card lands in the slot: where it was dropped, or back where it
  // started.
  function end(dropped: boolean) {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    d.stop();
    const moved = dropped && d.key !== d.startKey;
    if (moved) {
      flushSync(() => props.current.onDrop(d.move));
      navigator.vibrate?.(15);
    } else {
      flipColumns(() => props.current.onDrop(null));
    }
    const el = columnEl(d.id);
    if (!el) {
      d.clone.remove();
      return;
    }
    for (const a of el.getAnimations()) a.cancel();
    const to = el.getBoundingClientRect();
    el.style.visibility = "hidden";
    void d.clone
      .animate(
        [
          { translate: d.clone.style.translate || "0 0", scale: d.clone.style.scale || "1", boxShadow: LIFTED },
          { translate: `${to.left - d.rect.left}px ${to.top - d.rect.top}px`, scale: "1", boxShadow: "none" },
        ],
        { duration: reducedMotion() ? 0 : 200, easing: EASING, fill: "forwards" },
      )
      .finished.finally(() => {
        d.clone.remove();
        el.style.visibility = "";
      });
  }

  useDndMonitor({
    onDragStart({ active, activatorEvent }) {
      if (isList(active)) start(active, activatorEvent);
    },
    onDragEnd({ active }) {
      if (isList(active)) end(true);
    },
    onDragCancel({ active }) {
      if (isList(active)) end(false);
    },
  });

  return null;
}

/** A tray as the move sheet shows it: Personal, or a Space. */
export interface TrayView {
  /** The Space's id, null for Personal. */
  spaceId: string | null;
  name: string;
  icon: string | null;
  color: SpaceColor | null;
}

/** A list dropped on another tray, waiting to be confirmed (MoveListDialog). */
export interface ListMoveRequest {
  list: { id: string; name: string; icon: string | null; homepageUrl: string | null; userId: string };
  from: TrayView;
  to: TrayView;
}

type Person = AvatarUser & { role: SpaceRole };

/**
 * Asks before a list dropped on another tray goes into that Space, or out
 * of its own, since either changes who has it: it shows where it's going,
 * who'll gain it and who'll lose it. Held, dimmed, while the move saves.
 */
export function MoveListDialog({
  request,
  viewerId,
  onConfirm,
  onCancel,
}: {
  request: ListMoveRequest | null;
  viewerId: string;
  /** Saves the move; resolves once it's saved or has failed. */
  onConfirm: () => Promise<unknown>;
  onCancel: () => void;
}) {
  // The last one stays on show while the sheet closes.
  const [shown, setShown] = useState(request);
  if (request && request !== shown) setShown(request);
  const [pending, start] = useTransition();
  return (
    <ResponsiveDialog open={request !== null} onOpenChange={(open) => !open && !pending && onCancel()}>
      <ResponsiveDialogContent
        // A confirmation: nothing to type.
        initialFocus={null}
      >
        {shown && (
          <MoveListSheet
            key={`${shown.list.id}:${shown.to.spaceId}`}
            request={shown}
            viewerId={viewerId}
            pending={pending}
            onConfirm={() =>
              start(async () => {
                await onConfirm();
              })
            }
            onCancel={onCancel}
          />
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function MoveListSheet({
  request: { list, from, to },
  viewerId,
  pending,
  onConfirm,
  onCancel,
}: {
  request: ListMoveRequest;
  viewerId: string;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // Who gains and loses it: the Spaces' people, less anyone who has it
  // another way (its owner, its own members, or both Spaces), and the viewer.
  const [people, setPeople] = useState<{
    gaining: Person[];
    losing: Person[];
    fromSize: number;
    toSize: number;
  } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    const inSpace = (id: string | null) =>
      id ? listSpaceMembersAction(id).then((m) => m.filter((p) => p.status === "accepted")) : Promise.resolve([]);
    void runAction(
      Promise.all([inSpace(from.spaceId), inSpace(to.spaceId), listMembersAction(list.id)]).then(
        ([fromPeople, toPeople, members]) => {
          if (!live) return;
          // As the server decides (revokeListAccess): anyone left without
          // edit loses it and comes off its items, the viewer included (an
          // admin taking someone else's list out of their Space).
          const accepted = members.filter((m) => m.status === "accepted");
          const anyDirect = new Set([list.userId, ...accepted.map((m) => m.userId)]);
          const editDirect = new Set([
            list.userId,
            ...accepted.filter((m) => m.role === "editor").map((m) => m.userId),
          ]);
          const edits = (r: SpaceRole) => r === "admin" || r === "member";
          const fromIds = new Set(fromPeople.map((p) => p.userId));
          const toEditors = new Set(toPeople.filter((p) => edits(p.role)).map((p) => p.userId));
          const person = (p: Omit<Person, "image">): Person => ({ ...p, image: null });
          setPeople({
            gaining: toPeople.filter((p) => !anyDirect.has(p.userId) && !fromIds.has(p.userId)).map(person),
            losing: fromPeople
              .filter((p) => edits(p.role) && !editDirect.has(p.userId) && !toEditors.has(p.userId))
              .map(person),
            fromSize: fromPeople.length,
            toSize: toPeople.length,
          });
        },
      ),
      `check moving “${list.name}”`,
    ).then((ok) => {
      if (live && !ok) setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [list.id, list.name, list.userId, from.spaceId, to.spaceId]);

  const leaving = to.spaceId === null;
  return (
    // Held: the whole sheet dims while the move saves (closing is ignored
    // meanwhile, see MoveListDialog).
    <div
      aria-busy={pending}
      className={`flex min-h-0 flex-1 flex-col transition-opacity ${pending ? "opacity-60" : ""}`}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <ResponsiveDialogTitle className="flex min-w-0 items-center gap-1.5">
          {leaving ? "Remove from" : "Move to"} <TrayBadge tray={leaving ? from : to} />
        </ResponsiveDialogTitle>
        <ResponsiveDialogDescription className="sr-only">
          Check who gains and loses this list before it moves.
        </ResponsiveDialogDescription>
        <ResponsiveDialogCloseButton className="ml-auto" />
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4 text-sm">
        {/* Where it goes: the list leaving one tray for the other. */}
        <section aria-label="Where it goes" className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2">
          <TrayCard label="From" tray={from} size={people?.fromSize}>
            <ListChip list={list} leaving />
          </TrayCard>
          <div className="flex items-center">
            <span className="flex size-7 items-center justify-center rounded-full border border-input bg-background">
              <ArrowRight className="size-3.5 text-muted-foreground" />
            </span>
          </div>
          <TrayCard label="To" tray={to} size={people?.toSize}>
            <ListChip list={list} />
          </TrayCard>
        </section>

        {/* Who it changes things for. */}
        <section aria-label="Access" className="space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 className="text-xs font-medium text-muted-foreground">Access</h3>
            {people && (
              <span className="ml-auto flex gap-1.5">
                {!leaving && <AccessCount change="gains" n={people.gaining.length} />}
                {from.spaceId && <AccessCount change="loses" n={people.losing.length} />}
              </span>
            )}
          </div>
          {!people ? (
            <p className="text-muted-foreground">
              {failed ? (
                "Couldn't check who has this list."
              ) : (
                <>
                  Checking
                  <LoadingEllipsis />
                </>
              )}
            </p>
          ) : people.gaining.length + people.losing.length === 0 ? (
            <p className="rounded-lg border border-dashed border-input px-3 py-2.5 text-muted-foreground">
              No one gains or loses it: everyone who has it now keeps it.
            </p>
          ) : (
            <ul className="divide-y divide-neutral-200 rounded-lg border border-input dark:divide-neutral-800">
              {people.gaining.map((p) => (
                <PersonRow key={p.userId} person={p} you={p.userId === viewerId} change="gains" via={to.name} />
              ))}
              {people.losing.map((p) => (
                <PersonRow key={p.userId} person={p} you={p.userId === viewerId} change="loses" via={from.name} />
              ))}
            </ul>
          )}
          {people && people.losing.length > 0 && (
            <p className="flex gap-1.5 text-xs text-amber-700 dark:text-amber-400">
              <TriangleAlert className="mt-px size-3.5 shrink-0" />
              Anyone losing access comes off any of its items they’re on.
            </p>
          )}
        </section>
      </div>

      <div className="flex shrink-0 justify-end gap-2 border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-disabled={pending}
          onClick={() => !pending && onCancel()}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          // Solid red, not the menus' pale destructive: it's the sheet's
          // one action, and it takes the list away from people.
          className={leaving ? "bg-red-700 text-white hover:bg-red-800 dark:bg-red-600 dark:hover:bg-red-500" : undefined}
          aria-disabled={pending}
          onClick={() => !pending && onConfirm()}
        >
          {leaving ? <LogOut data-icon="inline-start" /> : <Boxes data-icon="inline-start" />}
          {pending ? (
            <>
              {leaving ? "Removing" : "Moving"}
              <LoadingEllipsis />
            </>
          ) : leaving ? (
            "Remove"
          ) : (
            "Move"
          )}
        </Button>
      </div>
    </div>
  );
}

/** One end of the move: a tray, on its own tint as on the board, holding the list. */
function TrayCard({
  label,
  tray,
  size,
  children,
}: {
  label: string;
  tray: TrayView;
  /** How many people are in the Space, once known. */
  size?: number;
  children: ReactNode;
}) {
  return (
    <div className={`flex min-w-0 flex-col gap-2 rounded-xl p-2.5 ${spaceTint(tray.color)}`}>
      <div className="text-[10px] font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {label}
      </div>
      <div className="flex min-w-0">
        <TrayBadge tray={tray} />
      </div>
      <div className="flex items-center gap-1 text-xs text-neutral-600 dark:text-neutral-400">
        <Users className="size-3 shrink-0" />
        {tray.spaceId === null
          ? "Not shared by a Space"
          : size === undefined
            ? "Space"
            : `${size} ${size === 1 ? "person" : "people"} in it`}
      </div>
      {children}
    </div>
  );
}

/** A tray as a badge in its Space's colour: its icon (or a person for Personal) and name. */
function TrayBadge({ tray }: { tray: TrayView }) {
  return (
    <span
      className={`inline-flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-sm font-medium text-neutral-800 ring-1 ring-black/10 ring-inset dark:text-neutral-100 dark:ring-white/10 ${spaceSwatch(tray.color)}`}
    >
      {tray.icon ? (
        <ProjectIcon icon={tray.icon} homepageUrl={null} name={tray.name} size={14} />
      ) : tray.spaceId === null ? (
        <User className="size-3.5 shrink-0 opacity-70" />
      ) : (
        <Boxes className="size-3.5 shrink-0 opacity-70" />
      )}
      <span className="truncate">{tray.name}</span>
    </span>
  );
}

/** The list as a little card: faded in the tray it leaves, solid where it lands. */
function ListChip({ list, leaving = false }: { list: ListMoveRequest["list"]; leaving?: boolean }) {
  return (
    <div
      className={`mt-auto flex min-w-0 items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs font-medium ${
        leaving
          ? "border-dashed border-neutral-400/60 text-neutral-500 dark:border-neutral-600"
          : "border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
      }`}
    >
      <span className={leaving ? "opacity-50" : undefined}>
        <ProjectIcon icon={list.icon} homepageUrl={list.homepageUrl} name={list.name} size={16} />
      </span>
      <span className={`truncate ${leaving ? "line-through decoration-neutral-400" : ""}`}>{list.name}</span>
    </div>
  );
}

const CHANGE = {
  gains: {
    Icon: UserPlus,
    label: "Gains access",
    pill: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400",
  },
  loses: {
    Icon: UserMinus,
    label: "Loses access",
    pill: "bg-destructive/10 text-destructive dark:bg-destructive/20",
  },
} as const;

/** "+2 gain access", "1 loses access", for the section's header. */
function AccessCount({ change, n }: { change: keyof typeof CHANGE; n: number }) {
  const { Icon, pill } = CHANGE[change];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${
        n ? pill : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
      }`}
    >
      <Icon className="size-3" />
      {n} {change === "gains" ? (n === 1 ? "gains" : "gain") : n === 1 ? "loses" : "lose"}
    </span>
  );
}

const CAN: Record<SpaceRole, string> = {
  admin: "can see and change it",
  member: "can see and change it",
  commenter: "can see and comment on it",
  viewer: "can see it",
};

function PersonRow({
  person,
  you,
  change,
  via,
}: {
  person: Person;
  /** The viewer, who can lose it too: an admin taking it out of their Space. */
  you: boolean;
  change: keyof typeof CHANGE;
  /** The Space they gain it through or lose it with. */
  via: string;
}) {
  const { Icon, label, pill } = CHANGE[change];
  return (
    <li className="flex items-center gap-2.5 px-2.5 py-2">
      <UserAvatar user={person} size={24} />
      <span className="min-w-0 flex-1">
        <span className="block truncate">
          {person.name || assigneeName(person)}
          {you && <span className="text-muted-foreground"> (you)</span>}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {change === "gains" ? `Through ${via}: ${CAN[person.role]}` : `Only had it through ${via}`}
        </span>
      </span>
      <span
        className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ${pill}`}
      >
        <Icon className="size-3.5" />
        {label}
      </span>
    </li>
  );
}
