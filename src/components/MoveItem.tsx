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
  // Not for an item in an archived list, which isn't among them; as the
  // details' List field.
  if (!move?.groups.some((g) => g.lists.some((l) => l.id === item.projectId))) return null;
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
  const [open, setOpen] = useState(false);
  const current = move?.groups
    .flatMap((g) => g.lists)
    .find((l) => l.id === item.projectId);
  if (!move || !current) return null;
  const labelled = move.groups.length > 1;
  return (
    // Held, not disabled, while another change saves, so it keeps focus.
    <DropdownMenu open={open} onOpenChange={(next) => setOpen(next && !disabled)}>
      <DropdownMenuTrigger
        aria-disabled={disabled}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-neutral-100 aria-disabled:opacity-50 dark:hover:bg-neutral-800"
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
  // What to do with each missing label, by name.
  const [labelChoice, setLabelChoice] = useState<Record<string, MissingLabels>>(
    {},
  );
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

  const needsChoice =
    plan?.missingLabels.some((l) => !labelChoice[l.name]) ?? false;
  function confirm() {
    if (!plan || pending || needsChoice) return;
    start(async () => {
      await runAction(
        moveItemAction(
          item.id,
          plan.to.id,
          plan.token,
          plan.missingLabels.length ? labelChoice : undefined,
        ).then((r) => {
          if (!r.moved) {
            // Something changed since the preview: show the move as it is now.
            setPlan(r.plan);
            setChanged(true);
            // Keep the choices for labels that are still missing.
            setLabelChoice((cur) =>
              Object.fromEntries(
                r.plan.missingLabels.flatMap((l) =>
                  cur[l.name] ? [[l.name, cur[l.name]]] : [],
                ),
              ),
            );
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
                  Labels {plan.to.name} has
                </h3>
                <ul className="space-y-1">
                  {plan.matchedLabels.map((l) => (
                    <li
                      key={l.to}
                      className="flex flex-wrap items-center gap-x-2 gap-y-0.5"
                    >
                      <LabelBadge name={l.to} emoji={emojiIn(toLabels, l.to)} />
                      {l.from !== l.to && (
                        <span className="text-xs whitespace-nowrap text-muted-foreground">
                          was “{l.from}”
                        </span>
                      )}
                      <OnItems ids={l.itemIds} refs={plan.refs} />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {plan.missingLabels.length === 1 && (
              <section className="space-y-1.5">
                <h3 className="text-xs font-medium text-muted-foreground">
                  {`Label ${plan.to.name} doesn't have`}
                </h3>
                <div className="flex items-center gap-2">
                  <LabelBadge
                    name={plan.missingLabels[0].name}
                    emoji={emojiIn(fromLabels, plan.missingLabels[0].name)}
                  />
                  <OnItems
                    ids={plan.missingLabels[0].itemIds}
                    refs={plan.refs}
                  />
                </div>
                <LabelChoiceCards
                  name={plan.missingLabels[0].name}
                  listName={plan.to.name}
                  value={labelChoice[plan.missingLabels[0].name]}
                  pending={pending}
                  onChange={(v) =>
                    setLabelChoice({ [plan.missingLabels[0].name]: v })
                  }
                />
              </section>
            )}

            {plan.missingLabels.length > 1 && (
              <section className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-medium text-muted-foreground">
                    {`Labels ${plan.to.name} doesn't have`}
                  </h3>
                  <span className="ml-auto flex gap-1">
                    {(
                      [
                        ["create", "Add all"],
                        ["drop", "Remove all"],
                      ] as const
                    ).map(([value, label]) => (
                      <Button
                        key={value}
                        type="button"
                        variant="ghost"
                        size="xs"
                        aria-disabled={pending}
                        onClick={() =>
                          !pending &&
                          setLabelChoice(
                            Object.fromEntries(
                              plan.missingLabels.map((l) => [l.name, value]),
                            ),
                          )
                        }
                      >
                        {label}
                      </Button>
                    ))}
                  </span>
                </div>
                <ul className="divide-y divide-neutral-200 rounded-lg border border-input dark:divide-neutral-800">
                  {plan.missingLabels.map((l) => (
                    <li
                      key={l.name}
                      className="flex items-center gap-2 px-2.5 py-2"
                    >
                      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
                        <LabelBadge
                          name={l.name}
                          emoji={emojiIn(fromLabels, l.name)}
                        />
                        <OnItems ids={l.itemIds} refs={plan.refs} />
                      </span>
                      <LabelChoiceToggle
                        name={l.name}
                        listName={plan.to.name}
                        value={labelChoice[l.name]}
                        pending={pending}
                        onChange={(v) =>
                          setLabelChoice((cur) => ({ ...cur, [l.name]: v }))
                        }
                      />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {plan.unassigned.length > 0 && (
              <section className="space-y-1.5">
                <h3 className="text-xs font-medium text-muted-foreground">
                  Coming off {subs.length ? "the items" : "it"}
                </h3>
                <ul className="space-y-1">
                  {plan.unassigned.map((u) => (
                    <li
                      key={u.userId}
                      className="flex flex-wrap items-center gap-x-2 gap-y-0.5"
                    >
                      <span>{u.name}</span>
                      <OnItems ids={u.itemIds} refs={plan.refs} />
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  They can&apos;t see {plan.to.name}.
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

/**
 * Which of the moving items a label or person is on, when sub-items move
 * too: nothing when it's only the one item, "all 4 items", the titles of one
 * or two, or "3 of 6 items".
 */
function OnItems({ ids, refs }: { ids: string[]; refs: MovePlan["refs"] }) {
  if (refs.length < 2) return null;
  const titles = refs.filter((r) => ids.includes(r.id)).map((r) => r.title);
  const text =
    ids.length === refs.length
      ? `all ${refs.length} items`
      : ids.length <= 2
        ? titles.map((t) => `“${t}”`).join(", ")
        : `${ids.length} of ${refs.length} items`;
  return (
    <span className="min-w-0 text-xs text-pretty text-muted-foreground">
      on {text}
    </span>
  );
}

const CHOICES = [
  ["create", BadgePlus, "Add"],
  ["drop", BadgeMinus, "Remove"],
] as const;

/** The choice for a single missing label, as two cards. */
function LabelChoiceCards({
  name,
  listName,
  value,
  pending,
  onChange,
}: {
  name: string;
  listName: string;
  value: MissingLabels | undefined;
  pending: boolean;
  onChange: (value: MissingLabels) => void;
}) {
  const text = {
    create: [`Add to ${listName}`, "Keep it, emoji and all"],
    drop: ["Remove from item", "Move it without this label"],
  } as const;
  return (
    <div
      role="radiogroup"
      aria-label={`“${name}”`}
      className="grid gap-2 sm:grid-cols-2"
    >
      {CHOICES.map(([choice, Icon]) => {
        const checked = value === choice;
        const [title, hint] = text[choice];
        return (
          <button
            key={choice}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-disabled={pending}
            onClick={() => !pending && onChange(choice)}
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
              <span className="block text-xs text-muted-foreground">
                {hint}
              </span>
            </span>
            <span
              aria-hidden
              className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border ${
                checked
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input"
              }`}
            >
              {checked && <Check className="size-3" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The choice for one of several missing labels: Add or Remove, side by side. */
function LabelChoiceToggle({
  name,
  listName,
  value,
  pending,
  onChange,
}: {
  name: string;
  listName: string;
  value: MissingLabels | undefined;
  pending: boolean;
  onChange: (value: MissingLabels) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={`“${name}”`}
      className="flex shrink-0 rounded-md border border-input p-0.5"
    >
      {CHOICES.map(([choice, Icon, label]) => {
        const checked = value === choice;
        return (
          <button
            key={choice}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-disabled={pending}
            title={
              choice === "create"
                ? `Add “${name}” to ${listName}`
                : `Remove “${name}” from the item`
            }
            onClick={() => !pending && onChange(choice)}
            className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
              checked
                ? "bg-primary text-primary-foreground"
                : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            }`}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
