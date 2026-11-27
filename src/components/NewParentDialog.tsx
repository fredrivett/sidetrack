"use client";

import { IndentIncrease } from "lucide-react";
import { useRef, useTransition } from "react";
import type { Item } from "@/core/schema";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  ResponsiveDialog,
  ResponsiveDialogCloseButton,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from "./ui/responsive-dialog";
import { useDraft } from "./use-draft";
import { useItemChanges } from "./use-optimistic-items";

/**
 * Give an item a new parent: a task in its place that holds it as its first
 * sub-item, for when it turns out to be one step of something bigger. Held
 * (AGENTS.md, "Saving changes"): the server gives the parent its ref, so the
 * dialog dims until it lands, then closes and hands the parent to `onAdded`,
 * to open it and add the other steps.
 */
export function NewParentDialog({
  item,
  open,
  onOpenChange,
  onAdded,
}: {
  item: Item;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: (parent: Item) => void;
}) {
  const changes = useItemChanges();
  const [saving, start] = useTransition();
  const titleRef = useRef<HTMLInputElement>(null);
  const draft = useDraft(`item:${item.id}:new-parent`);
  const title = draft.value.trim();

  const change = (next: boolean) => {
    if (!saving) onOpenChange(next);
  };
  const add = () =>
    start(async () => {
      const parent = await changes.addParent(item, title);
      // Failed: stays open with what was typed, and a toast says so.
      if (!parent) return;
      draft.clear();
      onOpenChange(false);
      onAdded(parent);
    });

  return (
    <ResponsiveDialog open={open} onOpenChange={change}>
      <ResponsiveDialogContent initialFocus={titleRef}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!saving && title) add();
          }}
          aria-busy={saving || undefined}
          // A column with a scrolling body, as the other dialogs, so the
          // phone keyboard squeezes the body rather than cutting off the buttons.
          className={`flex min-h-0 flex-1 flex-col transition-opacity ${saving ? "opacity-60" : ""}`}
        >
          <div className="flex shrink-0 items-start gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
            <div className="min-w-0 flex-1">
              <ResponsiveDialogTitle>New parent</ResponsiveDialogTitle>
              <ResponsiveDialogDescription className="text-sm text-neutral-500">
                It takes the place of “{item.title}”, which becomes its first sub-item.
              </ResponsiveDialogDescription>
            </div>
            <ResponsiveDialogCloseButton className="shrink-0" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
            <Input
              ref={titleRef}
              value={draft.value}
              onChange={(e) => draft.set(e.target.value)}
              placeholder="What it's all part of"
              aria-label="Title"
              aria-disabled={saving || undefined}
            />
          </div>
          <div className="flex shrink-0 justify-end gap-2 border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
            <Button type="button" variant="ghost" onClick={() => change(false)} aria-disabled={saving || undefined}>
              Cancel
            </Button>
            <Button type="submit" aria-disabled={saving || !title || undefined}>
              <IndentIncrease />
              {saving ? "Adding…" : "Add parent"}
            </Button>
          </div>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
