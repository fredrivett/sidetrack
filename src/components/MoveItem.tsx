"use client";

import {
  ArrowRight,
  BadgeMinus,
  BadgePlus,
  Check,
  ChevronDown,
  FolderInput,
  TriangleAlert,
} from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import { moveItemAction, previewMoveItemAction } from "@/app/actions";
import type { MissingLabels, MovePlan } from "@/core/move";
import type { Item } from "@/core/schema";
import { Button } from "@/components/ui/button";
import {
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ResponsiveDialog,
  ResponsiveDialogCloseButton,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { LoadingEllipsis } from "@/components/ui/loading-ellipsis";
import type { ProjectView } from "./Kanban";
import { LabelBadge, useListLabels } from "./Labels";
import { ProjectIcon } from "./ProjectIcon";
import { runAction } from "./run-action";

/** The lists an item can move to, on their trays: Personal and each Space. */
export interface MoveTargets {
  groups: { id: string; name: string; lists: ProjectView[] }[];
  /** Ask to move `item` to list `projectId`: opens the confirmation sheet. */
  open: (item: Item, projectId: string) => void;
}

/** Provided by the board; absent (no moving) where there's only one list. */
export const MoveItemContext = createContext<MoveTargets | null>(null);
export const useMoveItem = () => useContext(MoveItemContext);

function ListOption({
  list,
  current,
}: {
  list: ProjectView;
  current: boolean;
}) {
  return (
    <>
      <ProjectIcon
        icon={list.icon}
        homepageUrl={list.homepageUrl}
        name={list.name}
        size={16}
      />
      <span className="truncate">{list.name}</span>
      {current && <Check className="ml-auto" />}
    </>
  );
}

/** "Move to list" in an item row's right-click menu. */
export function MoveToListContextMenu({ item }: { item: Item }) {
  const move = useMoveItem();
  if (!move) return null;
  const labelled = move.groups.length > 1;
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <FolderInput />
        Move to list
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="max-h-80 w-56 overflow-y-auto">
        {move.groups.map((g) => (
          <ContextMenuGroup key={g.id}>
            {labelled && <ContextMenuLabel>{g.name}</ContextMenuLabel>}
            {g.lists.map((l) => (
              <ContextMenuItem
                key={l.id}
                disabled={l.id === item.projectId}
                onClick={() => move.open(item, l.id)}
              >
                <ListOption list={l} current={l.id === item.projectId} />
              </ContextMenuItem>
            ))}
          </ContextMenuGroup>
        ))}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

/**
 * The item's list in its detail dialog, as a dropdown of the lists it can
 * move to: the touch way to move, where there's no row menu. Picking one
 * opens the confirmation sheet via `onPick`.
 */
export function MoveToListPicker({
  item,
  disabled,
  onPick,
}: {
  item: Item;
  disabled: boolean;
  onPick: (projectId: string) => void;
}) {
  const move = useMoveItem();
  const current = move?.groups
    .flatMap((g) => g.lists)
    .find((l) => l.id === item.projectId);
  if (!move || !current) return null;
  const labelled = move.groups.length > 1;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-neutral-100 disabled:opacity-50 dark:hover:bg-neutral-800"
      >
        <ProjectIcon
          icon={current.icon}
          homepageUrl={current.homepageUrl}
          name={current.name}
          size={16}
        />
        <span className="min-w-0 truncate">{current.name}</span>
        <span className="ml-auto shrink-0 text-xs text-neutral-500">
          Move to…
        </span>
        <ChevronDown className="size-4 shrink-0 opacity-50" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-80 w-64 overflow-y-auto"
      >
        {move.groups.map((g) => (
          <DropdownMenuGroup key={g.id}>
            {labelled && <DropdownMenuLabel>{g.name}</DropdownMenuLabel>}
            {g.lists.map((l) => (
              <DropdownMenuItem
                key={l.id}
                disabled={l.id === item.projectId}
                onClick={() => onPick(l.id)}
              >
                <ListOption list={l} current={l.id === item.projectId} />
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Confirms a move to another list: what each item's ID becomes, how its
 * labels carry over (asking whether to create or drop the ones the list
 * doesn't have) and who comes off it. Every move goes through here, since
 * the server only moves an item as its preview showed. Held: the sheet
 * stays open, dimmed, until the move lands.
 */
export function MoveItemDialog({
  request,
  onClose,
}: {
  request: { item: Item; projectId: string } | null;
  onClose: () => void;
}) {
  // The last request stays on show while the sheet closes.
  const [shown, setShown] = useState(request);
  if (request && request !== shown) setShown(request);
  const [pending, start] = useTransition();
  return (
    <ResponsiveDialog
      open={request !== null}
      onOpenChange={(open) => !open && !pending && onClose()}
    >
      <ResponsiveDialogContent>
        {shown && (
          // A new request starts afresh.
          <MoveSheet
            key={`${shown.item.id}:${shown.projectId}`}
            item={shown.item}
            projectId={shown.projectId}
            pending={pending}
            start={start}
            onClose={onClose}
          />
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function MoveSheet({
  item,
  projectId,
  pending,
  start,
  onClose,
}: {
  item: Item;
  projectId: string;
  pending: boolean;
  start: (action: () => Promise<void>) => void;
  onClose: () => void;
}) {
  const [plan, setPlan] = useState<MovePlan | null>(null);
  const [changed, setChanged] = useState(false);
  const [labelChoice, setLabelChoice] = useState<MissingLabels | null>(null);
  const [failed, setFailed] = useState(false);
  const fromLabels = useListLabels(item.projectId);
  const toLabels = useListLabels(projectId);
  const emojiIn = (labels: typeof fromLabels, name: string) =>
    labels.find((l) => l.name === name)?.emoji ?? null;

  // A read the person waits on, so a failure says so.
  useEffect(() => {
    let live = true;
    void runAction(
      previewMoveItemAction(item.id, projectId).then((p) => {
        if (live) setPlan(p);
      }),
      `check moving “${item.title}”`,
    ).then((ok) => {
      if (live && !ok) setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [item.id, item.title, projectId]);

  const needsChoice = (plan?.missingLabels.length ?? 0) > 0 && !labelChoice;
  function confirm() {
    if (!plan || pending || needsChoice) return;
    start(async () => {
      await runAction(
        moveItemAction(
          item.id,
          plan.to.id,
          plan.token,
          labelChoice ?? undefined,
        ).then((r) => {
          if (!r.moved) {
            // Something changed since the preview: show the move as it is now.
            setPlan(r.plan);
            setChanged(true);
            if (r.plan.missingLabels.join() !== plan.missingLabels.join())
              setLabelChoice(null);
            return;
          }
          onClose();
          toast(
            `Moved “${item.title}” to ${r.plan.to.name} as ${r.plan.refs[0].to}`,
          );
        }),
        `move “${item.title}”`,
      );
    });
  }

  const [top, ...subs] = plan?.refs ?? [];
  return (
    // Held: the whole sheet dims while the move saves (closing it is
    // ignored meanwhile, see MoveItemDialog).
    <div
      aria-busy={pending}
      className={`flex min-h-0 flex-1 flex-col transition-opacity ${pending ? "opacity-60" : ""}`}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <ResponsiveDialogTitle className="min-w-0 truncate">
          Move to {plan?.to.name ?? "another list"}
        </ResponsiveDialogTitle>
        <ResponsiveDialogDescription className="sr-only">
          Check what moving this item to another list changes.
        </ResponsiveDialogDescription>
        <ResponsiveDialogCloseButton className="ml-auto" />
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 text-sm">
        {!plan ? (
          <p className="text-muted-foreground">
            {failed ? (
              "Couldn't check this move."
            ) : (
              <>
                Checking
                <LoadingEllipsis />
              </>
            )}
          </p>
        ) : (
          <>
            {changed && (
              <p className="flex gap-2 rounded-md bg-amber-50 px-3 py-2 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                Something changed since this opened. Check the move again.
              </p>
            )}
            <section className="space-y-1.5">
              <h3 className="text-xs font-medium text-muted-foreground">
                {subs.length ? "New IDs" : "New ID"}
              </h3>
              <ul className="space-y-1">
                {[top, ...subs].map((r) => (
                  <li
                    key={r.id}
                    className={`flex items-center gap-2 ${r === top ? "" : "pl-4"}`}
                  >
                    <span className="min-w-0 flex-1 truncate">{r.title}</span>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      {r.from}
                    </span>
                    <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
                    <span className="shrink-0 font-mono text-xs">{r.to}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                {subs.length ? "Their old IDs keep" : "The old ID keeps"}{" "}
                working for agents and in PR titles.
              </p>
            </section>

            {plan.matchedLabels.length > 0 && (
              <section className="space-y-1.5">
                <h3 className="text-xs font-medium text-muted-foreground">
                  Labels
                </h3>
                <ul className="flex flex-wrap gap-1.5">
                  {plan.matchedLabels.map((l) => (
                    <li key={l.from}>
                      <LabelBadge name={l.to} emoji={emojiIn(toLabels, l.to)} />
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  {plan.to.name} has{" "}
                  {plan.matchedLabels.length > 1 ? "these" : "this"} already.
                </p>
              </section>
            )}

            {plan.missingLabels.length > 0 && (
              <section className="space-y-1.5">
                <h3 className="text-xs font-medium text-muted-foreground">
                  {plan.matchedLabels.length
                    ? "Labels it doesn't have"
                    : "Labels"}
                </h3>
                <ul className="flex flex-wrap gap-1.5">
                  {plan.missingLabels.map((name) => (
                    <li key={name}>
                      <LabelBadge
                        name={name}
                        emoji={emojiIn(fromLabels, name)}
                      />
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  {plan.to.name} has no{" "}
                  {plan.missingLabels.length > 1 ? "labels" : "label"} by{" "}
                  {plan.missingLabels.length > 1 ? "these names" : "this name"}.
                </p>
                <div
                  role="radiogroup"
                  aria-label="Labels the list doesn't have"
                  className="grid gap-2 sm:grid-cols-2"
                >
                  {(
                    [
                      [
                        "create",
                        BadgePlus,
                        `Add to ${plan.to.name}`,
                        `Keep ${plan.missingLabels.length > 1 ? "them" : "it"}, emoji and all`,
                      ],
                      [
                        "drop",
                        BadgeMinus,
                        "Remove from item",
                        `Move it without ${plan.missingLabels.length > 1 ? "these labels" : "this label"}`,
                      ],
                    ] as const
                  ).map(([value, Icon, title, hint]) => {
                    const checked = labelChoice === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={checked}
                        aria-disabled={pending}
                        onClick={() => !pending && setLabelChoice(value)}
                        className={`flex items-start gap-2.5 rounded-lg border p-2.5 text-left transition outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
                          checked
                            ? "border-primary bg-accent"
                            : "border-input hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
                        }`}
                      >
                        <span
                          className={`flex size-7 shrink-0 items-center justify-center rounded-md ${
                            checked
                              ? "bg-primary text-primary-foreground"
                              : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                          }`}
                        >
                          <Icon className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{title}</span>
                          <span className="block text-xs text-muted-foreground">{hint}</span>
                        </span>
                        <span
                          aria-hidden
                          className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border ${
                            checked ? "border-primary bg-primary text-primary-foreground" : "border-input"
                          }`}
                        >
                          {checked && <Check className="size-3" />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {plan.unassigned.length > 0 && (
              <section className="space-y-1.5">
                <h3 className="text-xs font-medium text-muted-foreground">
                  Assignees
                </h3>
                <p>
                  {plan.unassigned.map((u) => u.name).join(", ")} can&apos;t see{" "}
                  {plan.to.name}, so they&apos;ll come off{" "}
                  {subs.length ? "these items" : "it"}.
                </p>
              </section>
            )}
          </>
        )}
      </div>

      <div className="flex shrink-0 justify-end gap-2 border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-disabled={pending}
          onClick={() => !pending && onClose()}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          aria-disabled={!plan || pending || needsChoice}
          onClick={confirm}
          className={!plan || needsChoice ? "opacity-50" : ""}
        >
          <FolderInput data-icon="inline-start" />
          {pending ? (
            <>
              Moving
              <LoadingEllipsis />
            </>
          ) : (
            "Move"
          )}
        </Button>
      </div>
    </div>
  );
}
