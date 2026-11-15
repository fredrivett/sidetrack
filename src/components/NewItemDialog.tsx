"use client";

import { ChevronDown, CircleDashed, CornerDownRight, Plus, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  addItemAction,
  createProjectAction,
  suggestForNewItemAction,
  suggestNewListIconsAction,
} from "@/app/actions";
import type { AssigneeView } from "@/core/members";
import type { Category, Project } from "@/core/schema";
import { toggleAssignee } from "@/lib/assignees";
import type { Repeat } from "@/lib/repeat";
import type { Due } from "@/lib/time";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import {
  ResponsiveDialog,
  ResponsiveDialogCloseButton,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Textarea } from "@/components/ui/textarea";
import { AssigneeOptions } from "./AssigneeOptions";
import { CreatableCombobox } from "./CreatableCombobox";
import { DueDatePicker } from "./DueDatePicker";
import { RepeatPicker } from "./RepeatPicker";
import { runAction } from "./run-action";
import { useAssignShortcuts } from "./useAssignShortcuts";
import { AvatarStack, assigneeNames } from "./UserAvatar";

// Wait for a pause in typing before asking Jev about the draft.
const SUGGEST_DELAY_MS = 400;

type Suggestion = Awaited<ReturnType<typeof suggestForNewItemAction>>;
type ItemHint = NonNullable<Suggestion["parent"]>;

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <span className="block text-[11px] font-medium uppercase tracking-wide text-neutral-400">
        {label}
      </span>
      {children}
    </div>
  );
}

export function NewItemDialog({
  open,
  onOpenChange,
  projects,
  categoriesByProject,
  assigneesByProject,
  viewerId,
  initialProjectId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: Project[];
  categoriesByProject: Record<string, Category[]>;
  assigneesByProject: Record<string, AssigneeView[]>;
  viewerId: string;
  initialProjectId: string | null;
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
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [assignOpen, setAssignOpen] = useState(false);
  const [due, setDue] = useState<Due | null>(null);
  const [repeat, setRepeat] = useState<Repeat | null>(null);
  const [subItems, setSubItems] = useState<string[]>([]);
  const [subDraft, setSubDraft] = useState("");
  // Remounts the repeat picker after each add, so a Custom draft goes too.
  const [added, setAdded] = useState(0);
  // The last title added in this session: the dialog stays open after each
  // add so you can enter a run of items, and this confirms each one landed.
  const [lastAdded, setLastAdded] = useState<string | null>(null);
  const [pending, start] = useTransition();
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
      setTitle("");
      setDescription("");
      setCategory("");
      setAssigneeIds([]);
      setAssignOpen(false);
      setDue(null);
      setRepeat(null);
      setSubItems([]);
      setSubDraft("");
      setLastAdded(null);
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
  const projectId = fixedProjectId || suggestion?.projectId || "";
  const listSuggested = !fixedProjectId && Boolean(projectId);
  // Sub-items go one level deep, so an item with its own checklist can't
  // go under a parent: neither offer one nor keep one while it has steps.
  const hasChecklist = subItems.length > 0 || Boolean(subDraft.trim());
  const chosenParent =
    !hasChecklist && parent?.projectId === projectId ? parent.item : null;
  const duplicate = suggestion?.duplicate ?? null;
  const parentHint =
    !hasChecklist && !chosenParent && suggestion?.parent?.id !== duplicate?.id
      ? (suggestion?.parent ?? null)
      : null;
  const categoryOptions = (categoriesByProject[projectId] ?? []).map((c) => ({
    value: c.name,
    label: c.name,
  }));
  // Only the list's owner and members can be assigned, so switching lists
  // drops anyone who isn't on the new one (and brings them back on return).
  const listAssignees = assigneesByProject[projectId] ?? [];
  const assigned = listAssignees.filter((a) => assigneeIds.includes(a.userId));
  const canAssignSelf = listAssignees.some((a) => a.userId === viewerId);
  // A and I as in the item dialog, once a list is chosen. They're ignored
  // while typing in a field.
  const openPicker = useCallback(() => setAssignOpen(true), []);
  const toggleMe = useCallback(
    () => setAssigneeIds((cur) => toggleAssignee(cur, viewerId)),
    [viewerId],
  );
  useAssignShortcuts({
    active: open && Boolean(projectId) && !pending,
    onOpenPicker: openPicker,
    onAssignToMe: canAssignSelf ? toggleMe : undefined,
  });
  // A new category typed for this item shows as chosen, like the others.
  if (category.trim() && !categoryOptions.some((o) => o.value === category.trim())) {
    categoryOptions.push({ value: category.trim(), label: category.trim() });
  }

  // Create a list from the List field, with an AI icon as in New list.
  function createList(name: string) {
    start(async () => {
      await runAction(
        suggestNewListIconsAction({ name, summary: "", homepageUrl: null })
          .then(([icon]) => createProjectAction({ name, icon: icon ?? null }))
          .then((created) => setPickedProjectId(created.id)),
        "create the list",
      );
    });
  }

  useEffect(() => {
    if (!open || !draft.title) return;
    let current = true;
    const timer = setTimeout(() => {
      void suggestForNewItemAction({
        projectId: fixedProjectId || null,
        ...draft,
      })
        .then((value) => {
          if (current) setSuggested({ for: context, value });
        })
        .catch(() => {});
    }, SUGGEST_DELAY_MS);
    return () => {
      current = false;
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

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t || !projectId || pending) return;
    const d = description.trim() || null;
    const c = category.trim() || null;
    const who = assigneeIds;
    const du = due;
    const r = repeat;
    const p = chosenParent?.id ?? null;
    // A sub-item still in its input counts, so it isn't lost to the click.
    const subs = [...subItems, subDraft.trim()].filter(Boolean);
    const startedIn = session.current;
    start(async () => {
      const added = await runAction(
        addItemAction({
          projectId,
          title: t,
          description: d,
          category: c,
          parentId: p,
          assigneeIds: assigned.map((a) => a.userId),
          dueDate: du?.dueDate ?? null,
          dueFrom: du?.dueFrom ?? null,
          repeat: r,
          subItems: subs,
        }),
        `add “${t}”`,
      );
      // A failed add keeps the form as it was, to try again.
      if (!added || session.current !== startedIn) return;
      // Stay open for the next item: clear what's per-item, keep the list
      // and category, and put the cursor back in the title. You can type
      // the next item while this one saves (submitting waits; the button
      // shows "Adding…"), so only clear fields that still hold what was
      // submitted — never text typed for the next item.
      setTitle((cur) => (cur.trim() === t ? "" : cur));
      setDescription((cur) => ((cur.trim() || null) === d ? "" : cur));
      // Assignees, a due date, repeat and parent belong to the item just
      // added, like its title.
      setAssigneeIds((cur) => (cur === who ? [] : cur));
      setDue((cur) => (cur === du ? null : cur));
      setRepeat((cur) => (cur === r ? null : cur));
      setParent((cur) => (cur?.item.id === p ? null : cur));
      // Sub-items can't be edited while it saves, so they're all this item's.
      setSubItems([]);
      setSubDraft("");
      setAdded((n) => n + 1);
      setLastAdded(t);
      titleRef.current?.focus();
    });
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent initialFocus={titleRef}>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
            <ResponsiveDialogTitle>New item</ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="sr-only">
              Create a new task in a list.
            </ResponsiveDialogDescription>
            <ResponsiveDialogCloseButton className="ml-auto" />
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4">
            <Field label="Title">
              <Input
                ref={titleRef}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Add a task…"
              />
              {duplicate && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Looks like {duplicate.ref} “{duplicate.title}” is already on
                  this list.
                </p>
              )}
              {parentHint && (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => setParent({ projectId, item: parentHint })}
                  className="max-w-full font-normal text-muted-foreground"
                >
                  <CornerDownRight data-icon="inline-start" />
                  <span className="truncate">
                    Add under {parentHint.ref} “{parentHint.title}”?
                  </span>
                </Button>
              )}
              {chosenParent && (
                <p className="inline-flex h-6 max-w-full items-center gap-1 rounded-md bg-muted pr-0.5 pl-1.5 text-xs">
                  <CornerDownRight className="size-3 shrink-0 text-muted-foreground" />
                  <span className="truncate">
                    Sub-item of {chosenParent.ref} “{chosenParent.title}”
                  </span>
                  <button
                    type="button"
                    aria-label="Don't add as a sub-item"
                    onClick={() => setParent(null)}
                    className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3" />
                  </button>
                </p>
              )}
            </Field>

            <Field label="Description">
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Description (optional)"
                disabled={pending}
                rows={3}
                className="resize-none text-sm"
              />
            </Field>

            <Field label="List">
              <CreatableCombobox
                options={projects.map((p) => ({ value: p.id, label: p.name }))}
                value={projectId}
                onChange={setPickedProjectId}
                onCreate={createList}
                placeholder="Choose a list…"
                ariaLabel="List"
                // Jev's suggestion stays muted until you pick a list.
                muted={listSuggested}
                disabled={pending}
              />
            </Field>

            <Field label="Category">
              <CreatableCombobox
                options={categoryOptions}
                value={category.trim()}
                onChange={setCategory}
                // A new category is created with the item that uses it.
                onCreate={setCategory}
                placeholder="Category (optional)"
                ariaLabel="Category"
                clearable
                disabled={pending}
              />
            </Field>

            <Field label="Assignees">
              <DropdownMenu open={assignOpen} onOpenChange={setAssignOpen}>
                <DropdownMenuTrigger
                  disabled={pending || !projectId}
                  // Bordered like the form's other fields.
                  className="flex h-8 w-full items-center gap-2 rounded-lg border border-input bg-transparent px-2.5 text-left text-sm transition-colors outline-none hover:bg-neutral-50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 dark:bg-input/30 dark:hover:bg-input/50"
                >
                  {assigned.length ? (
                    <>
                      <AvatarStack users={assigned} size={20} ringClassName="ring-popover" />
                      <span className="truncate text-neutral-700 dark:text-neutral-200">
                        {assigneeNames(assigned)}
                      </span>
                    </>
                  ) : (
                    <>
                      <CircleDashed className="size-5 text-neutral-400" />
                      <span className="text-neutral-500">Unassigned</span>
                    </>
                  )}
                  <Kbd className="ml-auto">A</Kbd>
                  <ChevronDown className="size-4 opacity-50" />
                </DropdownMenuTrigger>
                <DropdownMenuContent data-assignee-picker align="start" className="w-56">
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
                </DropdownMenuContent>
              </DropdownMenu>
            </Field>

            <Field label="Due">
              <DueDatePicker
                key={added}
                due={due}
                done={false}
                disabled={pending}
                onChange={setDue}
              />
            </Field>

            <Field label="Repeat">
              <RepeatPicker
                key={added}
                repeat={repeat}
                completedAt={null}
                due={due}
                disabled={pending}
                onChange={setRepeat}
              />
            </Field>

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
            {/* Always mounted so screen readers announce the first add too. */}
            <p
              role="status"
              className="mr-auto min-w-0 truncate text-xs text-neutral-500"
            >
              {lastAdded && `Added “${lastAdded}”`}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              {lastAdded ? "Done" : "Cancel"}
            </Button>
            <Button type="submit" size="sm" disabled={!title.trim() || !projectId || pending}>
              <Plus data-icon="inline-start" />
              {pending ? "Adding…" : "Add item"}
            </Button>
          </div>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
