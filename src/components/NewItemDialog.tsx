"use client";

import { Check, Copy, IndentIncrease, List, ListPlus, Plus, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import { addItemAction, createProjectAction } from "@/app/actions";
import type { AiReadResult } from "@/app/api/ai/reads";
import type { LabelEmoji } from "@/core/labels";
import type { AssigneeView } from "@/core/members";
import type { Item } from "@/core/schema";
import { toggleAssignee } from "@/lib/assignees";
import { cn } from "@/lib/utils";
import { formatItemRef } from "@/lib/itemRef";
import type { Repeat } from "@/lib/repeat";
import type { Due } from "@/lib/time";
import { Button } from "@/components/ui/button";
import { useStoredState } from "@/components/use-stored-state";
import { Input } from "@/components/ui/input";
import {
  ResponsiveDialog,
  ResponsiveDialogCloseButton,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { useCopy } from "@/components/ui/use-copy";
import { AssigneeOptions } from "./AssigneeOptions";
import { CreatableCombobox } from "./CreatableCombobox";
import { useToday } from "./use-day-start";
import { AssigneeChip, CHIP, DueChip, EMPTY_CHIP, Field, RepeatChip } from "./DialogFields";
import { LabelChips } from "./Labels";
import type { ProjectView } from "./Kanban";
import { ProjectIcon } from "./ProjectIcon";
import { runAction } from "./run-action";
import { useItemShortcuts } from "./useItemShortcuts";
import { aiRead } from "./ai-read";

// Wait for a pause in typing before asking Jev about the draft.
const SUGGEST_DELAY_MS = 400;

type Suggestion = AiReadResult<"newItem">;
type ItemHint = NonNullable<Suggestion["parent"]>;

/**
 * The toast confirming an add. The whole toast opens the item: the title's
 * button stretches over it with ::after (Sonner's toast is the positioned
 * box). The ref tag sits above that, so clicking it copies the ref instead.
 */
function AddedToast({
  title,
  itemRef,
  onOpen,
}: {
  title: string;
  itemRef: string;
  onOpen: () => void;
}) {
  const { copied, copy } = useCopy(itemRef);
  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 truncate text-left after:absolute after:inset-0 after:cursor-pointer"
      >
        Added “{title}”
      </button>
      <button
        type="button"
        onClick={() => void copy()}
        title="Copy ID"
        className="relative inline-flex shrink-0 items-center gap-1 rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[11px] tracking-wide text-neutral-600 transition hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
      >
        {copied ? (
          <Check className="size-3 opacity-70" />
        ) : (
          <Copy className="size-3 opacity-70" />
        )}
        {copied ? "Copied" : itemRef}
      </button>
    </span>
  );
}

const NO_SUB_ITEMS: string[] = [];

export function NewItemDialog({
  open,
  onOpenChange,
  onOpenItem,
  projects,
  assigneesByProject,
  viewerId,
  initialProjectId,
  dueToday = false,
  shownOnBoard,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opens an added item, from its toast. */
  onOpenItem: (item: Item) => void;
  projects: ProjectView[];
  assigneesByProject: Record<string, AssigneeView[]>;
  viewerId: string;
  initialProjectId: string | null;
  /** Opens due today, as from the Brief's "+", and keeps today for each next item. */
  dueToday?: boolean;
  /**
   * Whether an added item, with this many new sub-items, shows on the board
   * under the viewer's filters, for its toast.
   */
  shownOnBoard: (item: Item, subItems: number) => boolean;
}) {
  // The list the user chose, or the one the dialog was opened from; "" until
  // then, while Jev's suggestion (if any) stands in.
  const [pickedProjectId, setPickedProjectId] = useState("");
  // A parent the user accepted from a suggestion, with the list it's in.
  const [parent, setParent] = useState<{
    projectId: string;
    item: ItemHint;
  } | null>(null);
  // Jev's suggestion with the draft it was made for, so it's only used while
  // the form still says the same thing.
  const [suggested, setSuggested] = useState<{
    for: string;
    value: Suggestion;
  } | null>(null);
  // What's typed is kept until it's added or the dialog's cancelled, so a
  // reload (a deploy's, say) or the app closing in the background loses none.
  const [title, setTitle] = useStoredState("new-item:title", "");
  const [description, setDescription] = useStoredState("new-item:description", "");
  const [labels, setLabels] = useState<string[]>([]);
  // The emoji for labels new to the list, held until the item creates them.
  const [labelEmoji, setLabelEmoji] = useState<Record<string, LabelEmoji>>({});
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [assignOpen, setAssignOpen] = useState(false);
  const [dueOpen, setDueOpen] = useState(false);
  const [due, setDue] = useState<Due | null>(null);
  // Worked out as it's used, so a dialog left open past the day's turnover
  // gives the next item the new day, not the one it opened on.
  const today = useToday();
  const initialDue: Due | null = dueToday && today ? { dueFrom: null, dueDate: today } : null;
  const [repeat, setRepeat] = useState<Repeat | null>(null);
  const [subItems, setSubItems] = useStoredState("new-item:sub-items", NO_SUB_ITEMS);
  const [subDraft, setSubDraft] = useStoredState("new-item:sub-draft", "");
  // How many were added, so the same draft is asked about again.
  const [added, setAdded] = useState(0);
  // Whether anything was added in this session: Add & create more keeps the dialog
  // open so you can enter a run of items, so Cancel becomes Done.
  const [addedAny, setAddedAny] = useState(false);
  const [pending, start] = useTransition();
  // Which button the add in flight came from, for its "Adding…".
  const [addingAnother, setAddingAnother] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const subRef = useRef<HTMLInputElement>(null);
  // Each new step lands above the step input and pushes it down, out of view
  // once the dialog hits its max height, so scroll it back while typing.
  useLayoutEffect(() => {
    if (subRef.current === document.activeElement) {
      subRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [subItems.length]);
  // Bumped each time the dialog opens, so an add that finishes after the dialog
  // was closed (and maybe reopened) can't write into the new session's form.
  const session = useRef(0);
  useEffect(() => {
    if (open) session.current += 1;
  }, [open]);

  // Reset and seed the form every time the dialog opens — the project comes
  // from the caller (the centred column for ⌘N, or the chosen column's menu).
  // Adjusting state during render off a previous-value tracker is React's
  // recommended alternative to a reset-in-effect.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setPickedProjectId(initialProjectId ?? "");
      setParent(null);
      setSuggested(null);
      setLabels([]);
      setLabelEmoji({});
      setAssigneeIds([]);
      setAssignOpen(false);
      setDueOpen(false);
      setDue(initialDue);
      setRepeat(null);
      setAddedAny(false);
    }
  }

  const draft = { title: title.trim(), description: description.trim() };
  // An accepted parent holds its list for this item only, so the next item
  // in a run gets a fresh suggestion.
  const fixedProjectId = pickedProjectId || parent?.projectId || "";
  // `added` too: an add changes the list, so the same draft is asked again
  // (it may now be a duplicate of the item just added).
  const context = JSON.stringify([draft, fixedProjectId, added]);
  const suggestion =
    draft.title && suggested?.for === context ? suggested.value : null;
  // A suggested list counts only if it's one they can add to here.
  const suggestedList = projects.some((p) => p.id === suggestion?.projectId)
    ? suggestion?.projectId
    : null;
  const projectId = fixedProjectId || suggestedList || "";
  const listSuggested = !fixedProjectId && Boolean(projectId);
  const project = projects.find((p) => p.id === projectId);
  // Sub-items go one level deep, so an item with its own checklist can't
  // go under a parent: neither offer one nor keep one while it has steps.
  const hasChecklist = subItems.length > 0 || Boolean(subDraft.trim());
  const chosenParent =
    !hasChecklist && parent?.projectId === projectId ? parent.item : null;
  // Hints about items on a list they can't add to are no use here.
  const hints = projectId ? suggestion : null;
  const duplicate = hints?.duplicate ?? null;
  const parentHint =
    !hasChecklist && !chosenParent && hints?.parent?.id !== duplicate?.id
      ? (hints?.parent ?? null)
      : null;
  // Only those who can edit the list can be assigned, so switching lists
  // drops anyone who can't edit the new one (and brings them back on return).
  const listAssignees = assigneesByProject[projectId] ?? [];
  const assigned = listAssignees.filter((a) => a.canEdit && assigneeIds.includes(a.userId));
  const canAssignSelf = listAssignees.some((a) => a.canEdit && a.userId === viewerId);
  // A, I and D as in the item dialog, A and I once a list is chosen.
  // They're ignored while typing in a field.
  const openPicker = useCallback(() => setAssignOpen(true), []);
  const toggleMe = useCallback(
    () => setAssigneeIds((cur) => toggleAssignee(cur, viewerId)),
    [viewerId],
  );
  useItemShortcuts({
    active: open && !pending && !dueOpen,
    onOpenPicker: projectId ? openPicker : () => {},
    onAssignToMe: projectId && canAssignSelf ? toggleMe : undefined,
    onDue: () => setDueOpen(true),
  });

  // Create a list from the List field. Nobody chose its icon, so it gets
  // Jev's, as New list would give it.
  function createList(name: string) {
    start(async () => {
      await runAction(
        createProjectAction({ name, iconChosen: false }).then((created) =>
          setPickedProjectId(created.id),
        ),
        "create the list",
      );
    });
  }

  useEffect(() => {
    if (!open || !draft.title) return;
    // Newer typing gives up on the answer for this draft, and stops Jev's work on it.
    const stale = new AbortController();
    const timer = setTimeout(() => {
      // A suggestion that fails is just left out.
      aiRead("newItem", { projectId: fixedProjectId || null, ...draft }, stale.signal).then(
        (value) => {
          if (!stale.signal.aborted) setSuggested({ for: context, value });
        },
        () => {},
      );
    }, SUGGEST_DELAY_MS);
    return () => {
      stale.abort();
      clearTimeout(timer);
    };
    // `context` covers the draft, the fixed list and the adds so far.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, context]);

  function addSubItem() {
    const t = subDraft.trim();
    if (!t) return;
    setSubItems((cur) => [...cur, t]);
    setSubDraft("");
  }

  /**
   * Adds the item, then closes the dialog, or with `another` keeps it open
   * for the next one. Enter and ⌘Enter add and close, as the main button.
   */
  function add(another: boolean) {
    const t = title.trim();
    if (!t || !projectId || pending) return;
    const d = description.trim() || null;
    const ls = labels;
    const emoji = labelEmoji;
    const who = assigneeIds;
    const ids = assigned.map((a) => a.userId);
    const du = due;
    const r = repeat;
    const p = chosenParent?.id ?? null;
    // A sub-item still in its input counts, so it isn't lost to the click.
    const subs = [...subItems, subDraft.trim()].filter(Boolean);
    const startedIn = session.current;
    const prefix = projects.find((pr) => pr.id === projectId)?.refPrefix;
    setAddingAnother(another);
    start(async () => {
      const added = await runAction(
        addItemAction({
          projectId,
          title: t,
          description: d,
          labels: ls,
          labelEmoji: emoji,
          parentId: p,
          assigneeIds: ids,
          dueDate: du?.dueDate ?? null,
          dueFrom: du?.dueFrom ?? null,
          repeat: r,
          subItems: subs,
        }).then((item) => {
          const shown = shownOnBoard(item, subs.length);
          // Confirms each add in a run, even one that lands after the dialog
          // closed, and says when the viewer's filters keep it off the board.
          toast.success(
            <AddedToast
              title={t}
              itemRef={formatItemRef(prefix ?? "", item.number)}
              onOpen={() => {
                toast.dismiss(item.id);
                onOpenItem(item);
              }}
            />,
            { id: item.id, description: shown ? undefined : "Hidden by your filters" },
          );
        }),
        `add “${t}”`,
      );
      // A failed add keeps the form as it was, to try again.
      if (!added || session.current !== startedIn) return;
      if (!another) {
        close();
        return;
      }
      // Stay open for the next item: clear what's per-item, keep the list
      // and labels, and put the cursor back in the title. You can type
      // the next item while this one saves (submitting waits; the button
      // shows "Adding…"), so only clear fields that still hold what was
      // submitted — never text typed for the next item.
      setTitle((cur) => (cur.trim() === t ? "" : cur));
      setDescription((cur) => ((cur.trim() || null) === d ? "" : cur));
      // Assignees, a due date, repeat and parent belong to the item just
      // added, like its title; the date it opened with stays for the next.
      setAssigneeIds((cur) => (cur === who ? [] : cur));
      setDue((cur) => (cur === du ? initialDue : cur));
      setRepeat((cur) => (cur === r ? null : cur));
      setParent((cur) => (cur?.item.id === p ? null : cur));
      // Sub-items can't be edited while it saves, so they're all this item's.
      setSubItems(NO_SUB_ITEMS);
      setSubDraft("");
      setAdded((n) => n + 1);
      setAddedAny(true);
      titleRef.current?.focus();
    });
  }

  /** Closes the dialog, dropping what's typed. */
  function close() {
    setTitle("");
    setDescription("");
    setSubItems(NO_SUB_ITEMS);
    setSubDraft("");
    onOpenChange(false);
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <ResponsiveDialogContent initialFocus={titleRef}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            add(false);
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex shrink-0 flex-col gap-2 border-b border-neutral-200 px-4 pt-3 pb-4 dark:border-neutral-800">
            <div className="flex min-w-0 items-center gap-1">
              <ResponsiveDialogTitle className="text-sm font-medium text-neutral-500">
                New item
              </ResponsiveDialogTitle>
              <ResponsiveDialogDescription className="sr-only">
                Create a new task in a list.
              </ResponsiveDialogDescription>
              <ResponsiveDialogCloseButton className="ml-auto" />
            </div>
            <input
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Add a task…"
              aria-label="Title"
              className="w-full bg-transparent text-base leading-6 font-medium outline-none placeholder:text-muted-foreground"
            />
            {duplicate && (
              <p data-item-ref={duplicate.ref} className="text-xs text-amber-700 dark:text-amber-400">
                Looks like {duplicate.ref} “{duplicate.title}” is already on
                this list.
              </p>
            )}
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add description…"
              aria-label="Description"
              disabled={pending}
              rows={1}
              className="field-sizing-content max-h-48 w-full resize-none bg-transparent text-sm text-neutral-600 outline-none placeholder:text-muted-foreground disabled:opacity-50 dark:text-neutral-300"
            />
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              {/* First, and marked until chosen: nothing can be added without it. */}
              <CreatableCombobox
                options={projects.map((p) => ({ value: p.id, label: p.name }))}
                value={projectId}
                onChange={setPickedProjectId}
                onCreate={createList}
                placeholder="Find or create a list…"
                title={listSuggested ? "List (suggested by Jev)" : "List"}
                disabled={pending}
                className={
                  !project
                    ? cn(
                        EMPTY_CHIP,
                        "border-blue-500 text-blue-700 hover:text-blue-800 dark:border-blue-400/70 dark:text-blue-300 dark:hover:text-blue-200 [&_svg]:text-current",
                      )
                    : listSuggested
                      ? cn(CHIP, "border-dashed text-muted-foreground")
                      : CHIP
                }
              >
                {project ? (
                  <>
                    <ProjectIcon
                      icon={project.icon}
                      homepageUrl={project.homepageUrl}
                      name={project.name}
                      size={16}
                    />
                    <span className="min-w-0 truncate">{project.name}</span>
                  </>
                ) : (
                  <>
                    <List />
                    <span data-replay-safe>Choose a list</span>
                  </>
                )}
              </CreatableCombobox>
              <DueChip
                due={due}
                done={false}
                disabled={pending}
                onChange={setDue}
                open={dueOpen}
                setOpen={setDueOpen}
              />
              <RepeatChip
                repeat={repeat}
                completedAt={null}
                disabled={pending}
                onChange={setRepeat}
              />
              <AssigneeChip
                assigned={assigned}
                disabled={pending || !projectId}
                open={assignOpen}
                setOpen={(next) => setAssignOpen(next && Boolean(projectId))}
              >
                <AssigneeOptions
                  selected={assigned.map((a) => a.userId)}
                  assignees={listAssignees}
                  viewerId={viewerId}
                  // Ticking sets this list's people only; keep anyone
                  // picked on another list for when you switch back.
                  // Unassigned clears everyone.
                  onChange={(ids) =>
                    setAssigneeIds((cur) => [
                      ...cur.filter((id) => !listAssignees.some((a) => a.userId === id)),
                      ...ids,
                    ])
                  }
                  onClear={() => setAssigneeIds([])}
                />
              </AssigneeChip>
              {/* A new label is created with the item that uses it. */}
              <LabelChips
                projectId={projectId}
                value={labels}
                onChange={(names, added) => {
                  setLabels(names);
                  const emoji = added?.emoji;
                  if (added && emoji) {
                    setLabelEmoji((cur) => ({ ...cur, [added.name]: emoji }));
                  }
                }}
                draftEmoji={labelEmoji}
                // The label is renamed on the server; keep this item's name for it in step.
                onRenamed={(from, to) =>
                  setLabels((cur) => cur.map((n) => (n === from ? to : n)))
                }
                onDraftEmoji={(name, emoji) =>
                  setLabelEmoji((cur) => ({ ...cur, [name]: { emoji, chosen: true } }))
                }
                disabled={pending}
                chipClassName={labels.length ? `${EMPTY_CHIP} px-2` : EMPTY_CHIP}
              />
              {/* Jev's parent hint fills the dashed Parent chip; accepting it sets it. */}
              {chosenParent ? (
                <span
                  data-item-ref={chosenParent.ref}
                  title={`Sub-item of ${chosenParent.ref}`}
                  className={`${CHIP} pr-1`}
                >
                  <IndentIncrease />
                  <span className="max-w-48 truncate">{chosenParent.title}</span>
                  <button
                    type="button"
                    aria-label="Don't add as a sub-item"
                    onClick={() => setParent(null)}
                    className="shrink-0 rounded-full p-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-700"
                  >
                    <X />
                  </button>
                </span>
              ) : (
                parentHint && (
                  <button
                    type="button"
                    onClick={() => setParent({ projectId, item: parentHint })}
                    data-item-ref={parentHint.ref}
                    title={`Add under ${parentHint.ref} “${parentHint.title}”`}
                    className={EMPTY_CHIP}
                  >
                    <IndentIncrease />
                    <span className="max-w-56 truncate">
                      Add under “{parentHint.title}”?
                    </span>
                  </button>
                )
              )}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
            <Field label="Checklist">
              <div className="space-y-1">
                {subItems.map((sub, i) => (
                  <div key={i} className="flex items-center gap-2 pl-2.5">
                    <span className="min-w-0 flex-1 truncate text-sm">{sub}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      disabled={pending}
                      onClick={() => {
                        setSubItems((cur) => cur.filter((_, j) => j !== i));
                        // The button unmounts, so keep focus in the checklist.
                        subRef.current?.focus();
                      }}
                      aria-label={`Remove sub-item ${sub}`}
                      className="text-neutral-400"
                    >
                      <X />
                    </Button>
                  </div>
                ))}
                <Input
                  ref={subRef}
                  value={subDraft}
                  onChange={(e) => setSubDraft(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter adds the typed sub-item; on an empty input it
                    // submits the form as usual.
                    if (e.key === "Enter" && !e.nativeEvent.isComposing && subDraft.trim()) {
                      e.preventDefault();
                      addSubItem();
                    }
                  }}
                  placeholder={subItems.length ? "Add another…" : "Add a step…"}
                  disabled={pending}
                  className="text-sm"
                  aria-label="Add a sub-item"
                />
              </div>
            </Field>
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={close}
            >
              {addedAny ? "Done" : "Cancel"}
            </Button>
            {/* type="button", so Enter in a field presses Add item, not this. */}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => add(true)}
              disabled={!title.trim() || !projectId || pending}
            >
              <ListPlus data-icon="inline-start" />
              {pending && addingAnother ? "Adding…" : "Add & create more"}
            </Button>
            <Button type="submit" size="sm" disabled={!title.trim() || !projectId || pending}>
              <Plus data-icon="inline-start" />
              {pending && !addingAnother ? "Adding…" : "Add item"}
            </Button>
          </div>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
