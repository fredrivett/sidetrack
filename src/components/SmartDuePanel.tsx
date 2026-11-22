"use client";

import { Plus, X } from "lucide-react";
import { unstable_rethrow } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
  addSmartMatchAction,
  findSmartCandidatesAction,
  getSmartDueAction,
  removeSmartMatchAction,
  setSmartRuleAction,
} from "@/app/actions";
import type { SmartCandidate, SmartDueView } from "@/core/smartDue";
import type { Item } from "@/core/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DueBadge } from "./DueBadge";
import { runAction } from "./run-action";
import { useDraft } from "./use-draft";

/** How long before its match a smart item is due, in days. */
const LEADS: Array<[days: number, label: string]> = [
  [0, "On the day"],
  [1, "1 day before"],
  [7, "1 week before"],
  [14, "2 weeks before"],
];

/**
 * The due date popover's Smart tab: a rule in the person's words ("before
 * our next trip"), how long before the match it's due, and the matches its
 * date comes from, each removable. The server works the date out, so every
 * change holds (rule 4): the panel dims until it's saved.
 */
export function SmartDuePanel({
  item,
  disabled,
  onPlain,
}: {
  item: Item;
  disabled: boolean;
  /** After it's made a plain date again, back to the Date tab. */
  onPlain: () => void;
}) {
  const [pending, start] = useTransition();
  const busy = disabled || pending;
  const rule = useDraft(`item:${item.id}:smart-rule`, item.smartRule ?? "");
  const [view, setView] = useState<SmartDueView | null>(null);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<SmartCandidate[]>([]);
  // Bumped after a match changes, which needn't move the date, to load them again.
  const [version, setVersion] = useState(0);
  const lead = item.smartLead ?? 7;
  const smart = item.smartRule !== null;

  // Loaded again whenever the item's smart date changes, here or elsewhere.
  useEffect(() => {
    if (!smart) return;
    let stale = false;
    void runAction(
      getSmartDueAction(item.id).then((v) => {
        if (!stale) setView(v);
      }),
      `load the matches for “${item.title}”`,
    );
    return () => {
      stale = true;
    };
  }, [item.id, item.title, smart, item.dueDate, item.smartRule, item.smartLead, version]);

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const t = setTimeout(() => {
      findSmartCandidatesAction(item.id, q).then(setFound, (error) => {
        unstable_rethrow(error);
        setFound([]);
      });
    }, 150);
    return () => clearTimeout(t);
  }, [item.id, query]);

  function save(next: { rule: string; lead: number } | null, what: string, then?: () => void) {
    start(async () => {
      if (await runAction(setSmartRuleAction(item.id, next), what)) then?.();
    });
  }
  function saveRule() {
    const text = rule.value.trim();
    if (!text || (text === item.smartRule && smart)) return;
    save({ rule: text, lead }, `set a smart due date on “${item.title}”`, rule.clear);
  }

  return (
    <div
      data-replay-safe
      aria-disabled={busy || undefined}
      className="space-y-2 aria-disabled:opacity-60"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!busy) saveRule();
        }}
        className="flex items-center gap-1.5"
      >
        <Input
          value={rule.value}
          onChange={(e) => rule.set(e.target.value)}
          placeholder="before our next trip"
          aria-label="Smart due date rule"
          maxLength={200}
          className="h-7"
        />
        {(!smart || rule.value.trim() !== item.smartRule) && (
          <Button type="submit" size="xs" disabled={!rule.value.trim()} aria-disabled={busy || undefined}>
            {smart ? "Save" : "Set"}
          </Button>
        )}
      </form>
      {smart && (
        <>
          <div role="group" aria-label="When it's due" className="flex flex-wrap gap-1">
            {LEADS.map(([days, label]) => (
              <Button
                key={days}
                type="button"
                variant="outline"
                size="xs"
                aria-pressed={lead === days}
                aria-disabled={busy || undefined}
                onClick={() =>
                  !busy &&
                  lead !== days &&
                  save({ rule: item.smartRule ?? "", lead: days }, `change when “${item.title}” is due`)
                }
                className={
                  lead === days
                    ? "border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-800 hover:text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
                    : ""
                }
              >
                {label}
              </Button>
            ))}
          </div>
          <div className="space-y-0.5">
            <span className="block px-1 text-xs text-muted-foreground">Matches</span>
            {view?.matches.length ? (
              view.matches.map((m) => (
                <div
                  key={m.anchorId}
                  className={`flex min-h-7 min-w-0 items-center gap-2 rounded-md px-1 text-sm ${m.current ? "bg-muted" : ""}`}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {m.title ?? <span className="text-muted-foreground">An item you can’t see</span>}
                    {m.ref && <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">{m.ref}</span>}
                  </span>
                  {m.due.dueDate ? (
                    <DueBadge due={m.due.dueDate} from={m.due.dueFrom} done={m.done} />
                  ) : (
                    <span className="text-xs text-muted-foreground">No date</span>
                  )}
                  <button
                    type="button"
                    title="Not a match"
                    aria-label={`Not a match: ${m.title ?? "hidden item"}`}
                    aria-disabled={busy || undefined}
                    onClick={() =>
                      !busy &&
                      start(async () => {
                        await runAction(
                          removeSmartMatchAction(item.id, m.anchorId),
                          `remove a match from “${item.title}”`,
                        );
                        setVersion((v) => v + 1);
                      })
                    }
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ))
            ) : (
              <p className="px-1 text-xs text-muted-foreground">
                Nothing matches yet, so it has no date. Add the item it hangs off.
              </p>
            )}
          </div>
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5 px-1">
              <Plus className="size-3.5 shrink-0 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  if (!e.target.value.trim()) setFound([]);
                }}
                placeholder="Add match: find an item"
                aria-label="Find an item to match"
                className="h-7"
              />
            </div>
            {query.trim() !== "" &&
              found.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-disabled={busy || undefined}
                  onClick={() =>
                    !busy &&
                    start(async () => {
                      if (await runAction(addSmartMatchAction(item.id, c.id), `match “${c.title}”`)) {
                        setQuery("");
                        setFound([]);
                        setVersion((v) => v + 1);
                      }
                    })
                  }
                  className="flex min-h-7 w-full min-w-0 items-center gap-2 rounded-md px-1 text-left text-sm hover:bg-muted"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {c.title}
                    <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">{c.ref}</span>
                  </span>
                  {c.due.dueDate && <DueBadge due={c.due.dueDate} from={c.due.dueFrom} done={false} />}
                </button>
              ))}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-disabled={busy || undefined}
            onClick={() =>
              !busy &&
              save(null, `make “${item.title}” a plain due date`, () => {
                rule.clear();
                onPlain();
              })
            }
          >
            Make it a plain date
          </Button>
        </>
      )}
    </div>
  );
}
