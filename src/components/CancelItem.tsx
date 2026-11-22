"use client";

import { ArrowRight, CircleX } from "lucide-react";
import { unstable_rethrow } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { getReplacementAction } from "@/app/actions";
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
 * Cancel an item: close it without it being done, with an optional reason
 * and the ref of the item that did its work instead. Held (AGENTS.md,
 * "Saving changes"): the server resolves the ref and can refuse it, so the
 * dialog dims until the cancel lands, then closes; a refusal keeps it open
 * with what was typed.
 */
export function CancelItemDialog({
  item,
  open,
  onOpenChange,
}: {
  item: Item;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const changes = useItemChanges();
  const [saving, start] = useTransition();
  const reasonDraft = useDraft(`item:${item.id}:cancel-reason`);
  const replacedByDraft = useDraft(`item:${item.id}:replaced-by`);

  const change = (next: boolean) => {
    if (!saving) onOpenChange(next);
  };
  const cancel = () =>
    start(async () => {
      const ok = await changes.cancel(item, {
        reason: reasonDraft.value,
        replacedBy: replacedByDraft.value,
      });
      // Refused (an unknown ref, say): stays open with what was typed.
      if (!ok) return;
      reasonDraft.clear();
      replacedByDraft.clear();
      onOpenChange(false);
    });

  return (
    <ResponsiveDialog open={open} onOpenChange={change}>
      <ResponsiveDialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!saving) cancel();
          }}
          aria-busy={saving || undefined}
          className={`transition-opacity ${saving ? "opacity-60" : ""}`}
        >
          <div className="flex items-start gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
            <div className="min-w-0 flex-1">
              <ResponsiveDialogTitle>Cancel “{item.title}”</ResponsiveDialogTitle>
              <ResponsiveDialogDescription className="text-sm text-neutral-500">
                It leaves the board without counting as done. You can reopen it later.
              </ResponsiveDialogDescription>
            </div>
            <ResponsiveDialogCloseButton className="shrink-0" />
          </div>
          <div className="space-y-3 px-4 py-4">
            <label className="block space-y-1">
              <span className="text-xs text-neutral-500">Why (optional)</span>
              <Input
                value={reasonDraft.value}
                onChange={(e) => reasonDraft.set(e.target.value)}
                placeholder="Won't do"
                maxLength={500}
                aria-disabled={saving || undefined}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-neutral-500">Replaced by (optional)</span>
              <Input
                value={replacedByDraft.value}
                onChange={(e) => replacedByDraft.set(e.target.value)}
                placeholder="An item's ID, such as SDT-87"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                className="font-mono"
                aria-disabled={saving || undefined}
              />
            </label>
          </div>
          <div className="flex justify-end gap-2 border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
            <Button type="button" variant="ghost" onClick={() => change(false)} aria-disabled={saving || undefined}>
              Keep it open
            </Button>
            <Button type="submit" aria-disabled={saving || undefined}>
              <CircleX />
              {saving ? "Cancelling…" : "Cancel item"}
            </Button>
          </div>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

/** The chip a cancelled item wears: "Cancelled", or "→ SDT-87" when another item did its work. */
export function CancelledChip({ item }: { item: Item }) {
  // Kept with the id it's for, so a stale answer never shows on another.
  const [found, setFound] = useState<{ for: string; ref: string; title: string } | null>(null);
  const replacedById = item.replacedById;
  useEffect(() => {
    if (!replacedById) return;
    let live = true;
    // A background read (rule 1): without it the chip just says Cancelled.
    getReplacementAction(item.id)
      .then((r) => {
        if (live && r) setFound({ for: replacedById, ref: r.ref, title: r.title });
      })
      .catch((error) => {
        unstable_rethrow(error);
      });
    return () => {
      live = false;
    };
  }, [item.id, replacedById]);
  const replacement = found && found.for === replacedById ? found : null;

  const chip =
    "inline-flex items-center gap-1 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500 dark:bg-neutral-800";
  return (
    <>
      <span className={chip} title={item.cancelReason ?? undefined}>
        {/* The row's ✕ circle, small: closed without being done. */}
        <CircleX className="size-3" aria-hidden />
        Cancelled
      </span>
      {replacement && (
        <span className={chip} title={`Replaced by ${replacement.title}`} data-item-ref={replacement.ref}>
          <ArrowRight className="size-2.5" aria-label="Replaced by" />
          <span className="font-mono">{replacement.ref}</span>
        </span>
      )}
    </>
  );
}
