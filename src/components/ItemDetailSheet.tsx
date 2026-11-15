"use client";

import {
  CheckCircle2,
  ChevronDown,
  Circle,
  CircleDashed,
  Copy,
  IndentDecrease,
  IndentIncrease,
  Trash2,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  addItemAction,
  completeItemAction,
  deleteItemAction,
  setItemParentAction,
  uncompleteItemAction,
  updateItemAction,
} from "@/app/actions";
import type { AssigneeView } from "@/core/members";
import type { Item, ItemPrLink } from "@/core/schema";
import { formatItemRef } from "@/lib/itemRef";
import { modifierSymbol } from "@/lib/keyboard";
import { prLabel } from "@/lib/pr";
import { dayLabel, quickDueDays } from "@/lib/time";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useMediaQuery } from "@/components/ui/use-media-query";
import { AssigneeOptions } from "./AssigneeOptions";
import { CategoryBadge } from "./CategoryBadge";
import { DueBadge } from "./DueBadge";
import { useToday } from "./use-day-start";
import { EditableText } from "./EditableText";
import { InlineCode, Markdown } from "./Markdown";
import { useAssignShortcuts } from "./useAssignShortcuts";
import { useCopyItemRef } from "./useCopyItemRef";
import { assigneeName, UserAvatar } from "./UserAvatar";

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

/**
 * A task's sub-items, each ticked off in place, with an input that stays
 * focused after Enter so a whole checklist goes in one line after another.
 */
function Checklist({
  parent,
  items,
  assignees,
  viewerId,
  onOpenItem,
  pickerFor,
  onPickerFor,
}: {
  parent: Item;
  items: Item[];
  assignees: AssigneeView[];
  viewerId: string;
  onOpenItem: (item: Item) => void;
  /** The sub-item whose assignee picker is open, if any (owned by the sheet,
   * which hands its A/I shortcuts over while one is open). */
  pickerFor: string | null;
  onPickerFor: (id: string | null) => void;
}) {
  const [draft, setDraft] = useState("");
  // Checkboxes wait for the last toggle to land, so a quick second click
  // doesn't repeat it from the stale state.
  const [pending, start] = useTransition();
  // Adds run one after another, so lines typed quickly land in typed order.
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  function add() {
    const title = draft.trim();
    if (!title) return;
    setDraft("");
    queue.current = queue.current
      .then(() =>
        addItemAction({
          projectId: parent.projectId,
          title,
          parentId: parent.id,
        }),
      )
      .catch(() => toast.error(`Couldn't add “${title}”. Please try again.`));
  }

  return (
    <div className="space-y-1">
      {items.map((child) => {
        const done = child.completedAt !== null;
        const assignee = assignees.find((a) => a.userId === child.assigneeId);
        return (
          <div key={child.id} className="flex items-center gap-2 px-1 py-0.5">
            <Checkbox
              checked={done}
              disabled={pending}
              onCheckedChange={() =>
                start(() => {
                  void (done
                    ? uncompleteItemAction(child.id)
                    : completeItemAction(child.id));
                })
              }
              aria-label={`${done ? "Uncomplete" : "Complete"} ${child.title}`}
            />
            <button
              type="button"
              onClick={() => onOpenItem(child)}
              className={`min-w-0 flex-1 truncate text-left text-sm hover:underline ${
                done ? "text-neutral-400 line-through" : ""
              }`}
            >
              {child.title}
            </button>
            <DropdownMenu
              open={pickerFor === child.id}
              onOpenChange={(o) => onPickerFor(o ? child.id : null)}
            >
              <DropdownMenuTrigger
                aria-label={
                  assignee
                    ? `${child.title}: assigned to ${assigneeName(assignee)}. Reassign`
                    : `Assign ${child.title}`
                }
                className="flex size-6 shrink-0 items-center justify-center rounded-full text-neutral-300 transition hover:bg-neutral-100 hover:text-neutral-600 dark:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
              >
                {assignee ? (
                  <UserAvatar user={assignee} size={18} />
                ) : (
                  <UserRound className="size-4" />
                )}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <AssigneeOptions
                  currentId={child.assigneeId}
                  assignees={assignees}
                  viewerId={viewerId}
                  onPick={(assigneeId) =>
                    start(() => {
                      void updateItemAction(child.id, { assigneeId });
                    })
                  }
                />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      })}
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            add();
          }
        }}
        placeholder={items.length ? "Add another…" : "Add a step…"}
        aria-label={`Add a sub-item to ${parent.title}`}
      />
    </div>
  );
}

/**
 * The date input. Typing a date fires a change per segment (the year alone
 * passes through 0002, 0020, 0202), so it keeps a draft and saves once the
 * date settles: on a pause, on blur, or when the sheet closes. Keyed by item,
 * so a draft never carries over to another item.
 */
function DueDateInput({
  due,
  disabled,
  onChange,
}: {
  due: string | null;
  disabled: boolean;
  onChange: (due: string | null) => void;
}) {
  const [draft, setDraft] = useState(due ?? "");
  // A save or a quick button changed the date: show it.
  const [shown, setShown] = useState(due);
  if (due !== shown) {
    setShown(due);
    setDraft(due ?? "");
  }
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flush = useRef(() => {});
  useEffect(() => () => flush.current(), []);

  function change(value: string) {
    setDraft(value);
    clearTimeout(timer.current);
    flush.current = () => {
      clearTimeout(timer.current);
      flush.current = () => {};
      // An unfinished date reads as "": put the saved one back rather than
      // clearing it. Clear is the button's job.
      if (!value) setDraft(due ?? "");
      else if (value !== due) onChange(value);
    };
    timer.current = setTimeout(() => flush.current(), 800);
  }

  return (
    <input
      type="date"
      value={draft}
      disabled={disabled}
      onChange={(e) => change(e.target.value)}
      onBlur={() => flush.current()}
      aria-label="Pick a due date"
      className="h-6 rounded-md border border-neutral-200 bg-transparent px-1.5 text-xs text-neutral-600 dark:border-neutral-800 dark:text-neutral-300"
    />
  );
}

/** Quick due-date buttons, a date picker for anything else, and Clear. */
function DueDatePicker({
  due,
  done,
  disabled,
  onChange,
}: {
  due: string | null;
  done: boolean;
  disabled: boolean;
  onChange: (due: string | null) => void;
}) {
  const today = useToday();
  const quick = today ? quickDueDays(today) : [];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {/* A pressed quick button already says when it's due. */}
      {due && !quick.some(([, day]) => day === due) && (
        <DueBadge due={due} done={done} />
      )}
      {quick.map(([label, day]) => (
        <Button
          key={label}
          type="button"
          variant="outline"
          size="xs"
          disabled={disabled}
          aria-pressed={due === day}
          onClick={() => onChange(day)}
          className={
            due === day
              ? "border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-800 hover:text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
              : ""
          }
        >
          {label}
        </Button>
      ))}
      <DueDateInput due={due} disabled={disabled} onChange={onChange} />
      {due && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={disabled}
          onClick={() => onChange(null)}
        >
          Clear
        </Button>
      )}
    </div>
  );
}

export function ItemDetailSheet({
  item,
  parent,
  checklist,
  nestTargets,
  onOpenItem,
  prefix,
  assignees,
  viewerId,
  prLinks,
  open,
  onOpenChange,
}: {
  item: Item;
  /** For a sub-item, the task it belongs to. */
  parent: Item | null;
  /** This item's sub-items, in order. */
  checklist: Item[];
  /** Tasks this item can become a sub-item of: the list's other open
   * top-level tasks, in order. */
  nestTargets: Item[];
  /** Switch the sheet to another item (a sub-item or the parent). */
  onOpenItem: (item: Item) => void;
  prefix: string;
  assignees: AssigneeView[];
  viewerId: string;
  prLinks: ItemPrLink[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Sidebar slide-out on desktop, bottom drawer on mobile — same responsive
  // default as abode's dialog-or-drawer, built on our own Sheet primitive.
  const isDesktop = useMediaQuery("(min-width: 768px)", true);
  const [pending, start] = useTransition();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  // A sub-item's assignee picker in the checklist, when one is open.
  const [childPickerFor, setChildPickerFor] = useState<string | null>(null);
  const completed = item.completedAt !== null;
  const ref = formatItemRef(prefix, item.number);
  const assignee = assignees.find((a) => a.userId === item.assigneeId);
  const canAssignSelf = useMemo(
    () => assignees.some((a) => a.userId === viewerId),
    [assignees, viewerId],
  );

  const assign = useCallback(
    (assigneeId: string | null) => {
      start(() => {
        void updateItemAction(item.id, { assigneeId });
      });
    },
    [item.id],
  );
  const openPicker = useCallback(() => setAssignOpen(true), []);
  const assignToMe = useCallback(() => {
    assign(viewerId);
    setAssignOpen(false);
  }, [assign, viewerId]);

  // While the sheet is open, ⌘./Ctrl+. copies the ref (Linear's shortcut).
  const { copy } = useCopyItemRef(ref, { active: open });

  // Linear's assignment shortcuts while the sheet owns the screen: A opens the
  // picker, I assigns to me. Stays armed while the picker is open so the I hint
  // shown on the "me" row actually works there — base-ui's menu doesn't consume
  // letter keys, so we won't fight its typeahead. No deferToDialog: the sheet IS
  // the dialog and should respond.
  // While a sub-item's picker is open, I assigns that sub-item (as its menu's
  // hint says) and A does nothing, rather than both acting on this item.
  const assignChildToMe = useCallback(() => {
    if (!childPickerFor) return;
    const id = childPickerFor;
    start(() => {
      void updateItemAction(id, { assigneeId: viewerId });
    });
    setChildPickerFor(null);
  }, [childPickerFor, viewerId]);
  const noop = useCallback(() => {}, []);
  useAssignShortcuts({
    active: open && childPickerFor === null,
    onOpenPicker: openPicker,
    onAssignToMe: canAssignSelf ? assignToMe : undefined,
  });
  useAssignShortcuts({
    active: open && childPickerFor !== null,
    onOpenPicker: noop,
    onAssignToMe: canAssignSelf ? assignChildToMe : undefined,
  });

  function change(next: boolean) {
    if (!next) {
      setConfirmingDelete(false);
      // Reset the picker so a closed sheet never reopens with it already open
      // (which would also disarm the A/I shortcuts).
      setAssignOpen(false);
      setChildPickerFor(null);
    }
    onOpenChange(next);
  }

  function toggle() {
    start(() => {
      void (completed
        ? uncompleteItemAction(item.id)
        : completeItemAction(item.id));
    });
  }

  function del() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    start(() => {
      void deleteItemAction(item.id);
    });
    change(false);
  }

  return (
    <Sheet open={open} onOpenChange={change}>
      <SheetContent
        side={isDesktop ? "right" : "bottom"}
        className={
          isDesktop
            ? "w-full gap-0 p-0 data-[side=right]:sm:max-w-md"
            : "max-h-[85vh] gap-0 rounded-t-xl p-0"
        }
      >
        <SheetHeader className="gap-2 border-b border-neutral-200 px-4 py-3 pr-14 dark:border-neutral-800">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void copy()}
              title="Copy ID"
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px] tracking-wide text-neutral-500 transition hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
            >
              <Copy className="size-3 opacity-70" />
              {ref}
              <Kbd className="ml-0.5">{modifierSymbol()}.</Kbd>
            </button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={toggle}
              disabled={pending}
              aria-pressed={completed}
              className={`ml-auto ${
                completed
                  ? "border-green-600/30 bg-green-50 text-green-700 hover:bg-green-100 dark:border-green-500/30 dark:bg-green-950/40 dark:text-green-400 dark:hover:bg-green-950/70"
                  : ""
              }`}
            >
              {completed ? <CheckCircle2 /> : <Circle />}
              {completed ? "Completed" : "Complete"}
            </Button>
          </div>
          <SheetTitle className="text-base">
            <EditableText
              value={item.title}
              onSave={(next) => updateItemAction(item.id, { title: next })}
              required
              className={`block w-full break-words text-base font-medium ${
                completed ? "text-neutral-400 line-through" : ""
              }`}
              inputClassName="w-full text-base"
              renderValue={(title) => <InlineCode>{title}</InlineCode>}
            />
          </SheetTitle>
          <SheetDescription className="sr-only">
            Item details for {item.title}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <Field label="Description">
            <EditableText
              value={item.description ?? ""}
              onSave={(next) =>
                updateItemAction(item.id, { description: next || null })
              }
              multiline
              placeholder="Add description…"
              className="block w-full break-words text-sm text-neutral-600 dark:text-neutral-300"
              inputClassName="w-full text-sm"
              renderValue={(description) => <Markdown>{description}</Markdown>}
            />
          </Field>

          <Field label="Category">
            <EditableText
              value={item.category ?? ""}
              onSave={(next) =>
                updateItemAction(item.id, { category: next || null })
              }
              placeholder="Add category…"
              className="block w-full break-words text-sm text-neutral-600 dark:text-neutral-300"
              inputClassName="w-full text-sm"
              renderValue={(category) => <CategoryBadge category={category} />}
            />
          </Field>

          <Field label="Assignee">
            <DropdownMenu open={assignOpen} onOpenChange={setAssignOpen}>
              <DropdownMenuTrigger
                disabled={pending}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-neutral-100 disabled:opacity-50 dark:hover:bg-neutral-800"
              >
                {assignee ? (
                  <>
                    <UserAvatar user={assignee} size={20} />
                    <span className="truncate text-neutral-700 dark:text-neutral-200">
                      {assigneeName(assignee)}
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
              <DropdownMenuContent align="start" className="w-56">
                <AssigneeOptions
                  currentId={item.assigneeId}
                  assignees={assignees}
                  viewerId={viewerId}
                  onPick={assign}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          </Field>

          <Field label="Due">
            <DueDatePicker
              key={item.id}
              due={item.dueDate}
              done={completed}
              disabled={pending}
              onChange={(dueDate) =>
                start(() => {
                  void updateItemAction(item.id, { dueDate });
                })
              }
            />
          </Field>

          {parent ? (
            <Field label="Sub-item of">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onOpenItem(parent)}
                  className="min-w-0 flex-1 truncate text-left text-sm text-neutral-700 hover:underline dark:text-neutral-200"
                >
                  {parent.title}
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    start(() => {
                      void setItemParentAction(item.id, null);
                    })
                  }
                >
                  <IndentDecrease />
                  Move out
                </Button>
              </div>
            </Field>
          ) : (
            <>
              {/* The touch way to nest an existing task, where there's no row
                  menu: an item with sub-items can't become one. */}
              {checklist.length === 0 && nestTargets.length > 0 && (
                <Field label="Sub-item of">
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      disabled={pending}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-neutral-100 disabled:opacity-50 dark:hover:bg-neutral-800"
                    >
                      <IndentIncrease className="size-4 text-neutral-400" />
                      <span className="text-neutral-500">
                        None — make it a sub-item of…
                      </span>
                      <ChevronDown className="ml-auto size-4 opacity-50" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-64">
                      {nestTargets.map((t) => (
                        <DropdownMenuItem
                          key={t.id}
                          onClick={() =>
                            start(() => {
                              void setItemParentAction(item.id, t.id);
                            })
                          }
                        >
                          <span className="truncate">{t.title}</span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </Field>
              )}
              <Field
                label={
                  checklist.length
                    ? `Checklist · ${checklist.filter((c) => c.completedAt !== null).length}/${checklist.length}`
                    : "Checklist"
                }
              >
                <Checklist
                  parent={item}
                  items={checklist}
                  assignees={assignees}
                  viewerId={viewerId}
                  onOpenItem={(child) => {
                    setChildPickerFor(null);
                    onOpenItem(child);
                  }}
                  pickerFor={childPickerFor}
                  onPickerFor={setChildPickerFor}
                />
              </Field>
            </>
          )}

          {prLinks.length > 0 && (
            <Field label="Pull requests">
              <div className="flex flex-wrap gap-1">
                {prLinks.map((link) => (
                  <a
                    key={link.id}
                    href={link.prUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-block rounded bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-950/70"
                  >
                    {prLabel(link.prUrl)}
                  </a>
                ))}
              </div>
            </Field>
          )}
        </div>

        <SheetFooter className="mt-0 flex-row items-center justify-between border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <span className="text-xs text-neutral-400">
            {completed && item.completedAt
              ? `Completed ${dayLabel(item.completedAt)}`
              : `Created ${dayLabel(item.createdAt)}`}
          </span>
          <Button
            variant="destructive"
            size="sm"
            onClick={del}
            disabled={pending}
          >
            <Trash2 />
            {confirmingDelete ? "Confirm delete?" : "Delete"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
