"use client";

import {
  CheckCircle2,
  ChevronDown,
  Circle,
  CircleDashed,
  Copy,
  Trash2,
} from "lucide-react";
import { useCallback, useMemo, useState, useTransition } from "react";
import {
  completeItemAction,
  deleteItemAction,
  uncompleteItemAction,
  updateItemAction,
} from "@/app/actions";
import type { AssigneeView } from "@/core/members";
import type { Item, ItemPrLink } from "@/core/schema";
import { formatItemRef } from "@/lib/itemRef";
import { modifierSymbol } from "@/lib/keyboard";
import { prLabel } from "@/lib/pr";
import { dayLabel } from "@/lib/time";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
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

export function ItemDetailSheet({
  item,
  prefix,
  assignees,
  viewerId,
  prLinks,
  open,
  onOpenChange,
}: {
  item: Item;
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
  const assignToMe = useCallback(() => assign(viewerId), [assign, viewerId]);

  // While the sheet is open, ⌘./Ctrl+. copies the ref (Linear's shortcut).
  const { copy } = useCopyItemRef(ref, { active: open });

  // Linear's assignment shortcuts while the sheet owns the screen: A opens the
  // picker, I assigns to me. Disarmed while the picker is open (the menu owns
  // keys then). No deferToDialog — the sheet IS the dialog and should respond.
  useAssignShortcuts({
    active: open && !assignOpen,
    onOpenPicker: openPicker,
    onAssignToMe: canAssignSelf ? assignToMe : undefined,
  });

  function change(next: boolean) {
    if (!next) setConfirmingDelete(false);
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
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                item.kind === "milestone"
                  ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                  : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
              }`}
            >
              {item.kind}
            </span>
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
