"use client";

import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  Trash2,
} from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { deleteLabelAction, listLabelUsageAction, updateLabelAction } from "@/app/actions";
import type { LabelUsage } from "@/core/labels";
import type { Label } from "@/core/schema";
import { formatItemRef } from "@/lib/itemRef";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialogBackButton,
  ResponsiveDialogCloseButton,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { SavedLabelChip } from "./Labels";
import { runAction } from "./run-action";
import { ARMED_MENU_ITEM, useTapToConfirm } from "./use-tap-to-confirm";

const count = (n: number) => `${n} item${n === 1 ? "" : "s"}`;
const HEADING = "block text-[11px] font-medium uppercase tracking-wide text-neutral-400";

/**
 * Which items each of a list's labels is on, by label id; null while it
 * loads. Loaded while `enabled` (the dialog is open), again when `key`
 * changes (a label is renamed, archived, deleted or opened), and on
 * reload(), after a delete is refused because its items changed.
 */
export function useLabelUsage(projectId: string, enabled: boolean, key: string) {
  const [usage, setUsage] = useState<Record<string, LabelUsage> | null>(null);
  const [loads, setLoads] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void runAction(
      listLabelUsageAction(projectId).then((u) => live && setUsage(u)),
      "load the labels",
    );
    return () => {
      live = false;
    };
  }, [projectId, enabled, key, loads]);
  return { usage, reload: () => setLoads((n) => n + 1) };
}

/**
 * A list's labels, each a row that opens it on its own (LabelView). Archived
 * ones stay on their items but aren't offered for new ones; they're folded
 * away at the end.
 */
export function ListLabelsField({
  labels,
  usage,
  onOpen,
  focusId,
}: {
  labels: Label[];
  usage: Record<string, LabelUsage> | null;
  onOpen: (id: string) => void;
  /** The label just come back from, to focus its row again. */
  focusId: string | null;
}) {
  const archived = labels.filter((l) => l.archivedAt !== null);
  const [showArchived, setShowArchived] = useState(
    archived.some((l) => l.id === focusId),
  );
  if (labels.length === 0) {
    return <p className="text-sm text-neutral-400">No labels yet. Add them from an item.</p>;
  }
  const row = (label: Label) => {
    const u = usage?.[label.id];
    return (
      <li key={label.id}>
        <button
          type="button"
          autoFocus={label.id === focusId}
          onClick={() => onOpen(label.id)}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted",
            label.archivedAt !== null && "text-neutral-500",
          )}
        >
          {label.emoji && <span className="shrink-0 leading-none">{label.emoji}</span>}
          <span className="min-w-0 truncate">{label.name}</span>
          <span className="ml-auto shrink-0 text-xs text-neutral-500 tabular-nums">
            {u ? count(u.active.length + u.done.length) : "…"}
          </span>
          <ChevronRight className="size-3.5 shrink-0 text-neutral-400" />
        </button>
      </li>
    );
  };
  return (
    <div className="-mx-2 space-y-1">
      <ul>{labels.filter((l) => l.archivedAt === null).map(row)}</ul>
      {archived.length > 0 && (
        <>
          <button
            type="button"
            aria-expanded={showArchived}
            onClick={() => setShowArchived(!showArchived)}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
          >
            {showArchived ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            Archived ({archived.length})
          </button>
          {showArchived && <ul>{archived.map(row)}</ul>}
        </>
      )}
    </div>
  );
}

/**
 * One label on its own, as the list details dialog's second view: rename it
 * or change its emoji, see the items it's on (open ones, done ones folded
 * into a count), and archive or delete it from its footer. Deleting asks for
 * a second tap, naming how many items it comes off.
 */
export function LabelView({
  label,
  listName,
  prefix,
  usage,
  onBack,
  onRefused,
}: {
  label: Label;
  listName: string;
  prefix: string;
  /** Undefined while it loads. */
  usage: LabelUsage | undefined;
  onBack: () => void;
  /** The delete was refused, so its items may have changed: load them again. */
  onRefused: () => void;
}) {
  // Archiving and deleting hold the view, dimmed, until they land: the save,
  // then the board's refresh showing it. Then it goes back to the list: on
  // its own once an archived label is shown as archived, and by the dialog
  // once a deleted one is gone.
  const [pending, start] = useTransition();
  const [landed, setLanded] = useState(false);
  const saving = pending || landed;
  const [showDone, setShowDone] = useState(false);
  const tap = useTapToConfirm();
  const isArchived = label.archivedAt !== null;
  useEffect(() => {
    if (landed && isArchived) onBack();
  }, [landed, isArchived, onBack]);
  const total = usage ? usage.active.length + usage.done.length : null;

  // Archiving asks for a second tap, like deleting; restoring doesn't. One
  // hook, so arming either disarms the other.
  const archive = () => {
    // Restoring stays on the label, which is back in use.
    if (isArchived) {
      start(async () => {
        await runAction(
          updateLabelAction(label.id, { archived: false }),
          `restore the label “${label.name}”`,
        );
      });
      return;
    }
    tap.confirm(
      () =>
        start(async () => {
          const ok = await runAction(
            updateLabelAction(label.id, { archived: true }),
            `archive the label “${label.name}”`,
          );
          if (ok) setLanded(true);
        }),
      "archive",
    );
  };
  const del = () =>
    usage &&
    tap.confirm(() =>
      start(async () => {
        const ok = await runAction(
          deleteLabelAction(label.id, usage.token),
          `delete the label “${label.name}”`,
        );
        if (ok) setLanded(true);
        else onRefused();
      }),
      "delete",
    );

  return (
    <div
      aria-busy={saving || undefined}
      className={cn("flex min-h-0 flex-1 flex-col", saving && "opacity-60")}
    >
      <div className="flex shrink-0 flex-col gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <div className="flex items-center gap-2">
          <ResponsiveDialogBackButton label={listName} onClick={onBack} />
          <ResponsiveDialogCloseButton className="ml-auto" />
        </div>
        <ResponsiveDialogTitle className="flex items-center gap-2">
          <SavedLabelChip label={label} disabled={saving} />
          {isArchived && (
            <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
              Archived
            </span>
          )}
        </ResponsiveDialogTitle>
        <ResponsiveDialogDescription className="sr-only">
          The label {label.name} in {listName}, and the items it&apos;s on
        </ResponsiveDialogDescription>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4">
        <div className="space-y-1.5">
          <span className={HEADING}>{total === null ? "Items" : `On ${count(total)}`}</span>
          {!usage ? (
            <p className="text-sm text-neutral-400">Loading…</p>
          ) : total === 0 ? (
            <p className="text-sm text-neutral-400">Not on any items.</p>
          ) : (
            <div className="space-y-1.5">
              {usage.active.length > 0 && <UsageList items={usage.active} prefix={prefix} />}
              {usage.done.length > 0 && (
                <>
                  <button
                    type="button"
                    aria-expanded={showDone}
                    onClick={() => setShowDone(!showDone)}
                    className="flex items-center gap-1 rounded text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
                  >
                    {showDone ? (
                      <ChevronDown className="size-3.5" />
                    ) : (
                      <ChevronRight className="size-3.5" />
                    )}
                    {usage.done.length} done
                  </button>
                  {showDone && <UsageList items={usage.done} prefix={prefix} done />}
                </>
              )}
            </div>
          )}
        </div>
        <p className="text-xs text-neutral-400">
          {isArchived
            ? "Archived: it stays on these items, but isn't offered for new ones."
            : "Archiving keeps it on these items, but stops offering it for new ones."}
        </p>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <Button
          variant="outline"
          size="sm"
          aria-disabled={saving}
          className={cn(
            "aria-disabled:opacity-50",
            tap.isArmed("archive") &&
              "bg-foreground! text-background! hover:bg-foreground/90!",
          )}
          onClick={() => !saving && archive()}
        >
          {isArchived ? <ArchiveRestore /> : <Archive />}
          {isArchived
            ? "Restore"
            : tap.isArmed("archive")
              ? "Confirm archive?"
              : "Archive"}
        </Button>
        <Button
          variant="destructive"
          size="sm"
          aria-disabled={saving || !usage}
          onClick={() => !saving && del()}
          className={cn("aria-disabled:opacity-50", tap.isArmed("delete") && ARMED_MENU_ITEM)}
        >
          <Trash2 />
          {tap.isArmed("delete")
            ? total
              ? `Permanently delete from ${count(total)}?`
              : "Permanently delete?"
            : "Delete"}
        </Button>
      </div>
    </div>
  );
}

function UsageList({
  items,
  prefix,
  done,
}: {
  items: LabelUsage["active"];
  prefix: string;
  done?: boolean;
}) {
  return (
    <ul className="space-y-1">
      {items.map((it) => (
        <li key={it.id} className="flex min-w-0 items-baseline gap-2 text-sm">
          <span className="shrink-0 font-mono text-[11px] text-neutral-500">
            {formatItemRef(prefix, it.number)}
          </span>
          <span className={cn("min-w-0 truncate", done && "text-neutral-500 line-through")}>
            {it.title}
          </span>
        </li>
      ))}
    </ul>
  );
}
