"use client";

import { unstable_rethrow, useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { setNotificationLevelAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import type { NotificationLevel } from "@/core/schema";
import { LEVELS, levelLabel } from "./notification-levels";

/**
 * How much the viewer hears: their level for everything, and the Spaces and
 * lists they've set apart from it, set from those menus and reset here.
 */
// Due reminders' own choices, stored as levels for the "reminders" scope.
const REMINDERS: Array<{ level: NotificationLevel; label: string; hint: string }> = [
  { level: "all", label: "Notify me", hint: "At 8am: what's due that day, and what's still open from yesterday." },
  { level: "default", label: "Inbox only", hint: "The same, waiting in your inbox without a notification." },
  { level: "mine", label: "Off", hint: "No due reminders." },
];

export function NotificationLevelsPanel({
  level,
  reminders,
  overrides,
}: {
  /** Their level for everything. */
  level: NotificationLevel;
  /** How they hear due reminders. */
  reminders: NotificationLevel;
  /** Spaces and lists with a level of their own. */
  overrides: Array<{ scope: string; name: string; kind: "Space" | "List"; level: NotificationLevel }>;
}) {
  const router = useRouter();
  const name = useId();
  const remindersName = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Settings panels hold while saving and report failures inline.
  function save(scope: string, next: NotificationLevel | null) {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      try {
        await setNotificationLevelAction(scope, next);
        router.refresh();
      } catch (e) {
        // A signed-out session rejects with Next's redirect to /login.
        unstable_rethrow(e);
        setError("Couldn't change your notifications. Please try again.");
      }
    });
  }

  return (
    <div
      className="space-y-4 rounded-lg border border-border p-4 aria-disabled:opacity-60"
      aria-disabled={pending || undefined}
    >
      <div className="space-y-1">
        <h2 className="text-sm font-medium">Activity on your lists</h2>
        <p className="text-sm text-muted-foreground">
          What others do on the lists and Spaces you share. Set a Space or list apart from
          this in its ⋯ menu, under Notifications.
        </p>
      </div>

      <div role="radiogroup" aria-label="Notifications for everything" className="space-y-2">
        {LEVELS.map((l) => (
          <label key={l.level} className="flex cursor-pointer items-start gap-3 rounded-md">
            <input
              type="radio"
              name={name}
              className="mt-1 shrink-0 accent-neutral-900 dark:accent-neutral-100"
              checked={level === l.level}
              onChange={() => level !== l.level && save("all", l.level)}
              aria-disabled={pending || undefined}
            />
            <span className="space-y-0.5">
              <span className="block text-sm">{l.label}</span>
              <span className="block text-xs text-muted-foreground">{l.hint}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Due reminders</h3>
        <div role="radiogroup" aria-label="Due reminders" className="space-y-2">
          {REMINDERS.map((r) => (
            <label key={r.level} className="flex cursor-pointer items-start gap-3 rounded-md">
              <input
                type="radio"
                name={remindersName}
                className="mt-1 shrink-0 accent-neutral-900 dark:accent-neutral-100"
                checked={reminders === r.level}
                onChange={() => reminders !== r.level && save("reminders", r.level)}
                aria-disabled={pending || undefined}
              />
              <span className="space-y-0.5">
                <span className="block text-sm">{r.label}</span>
                <span className="block text-xs text-muted-foreground">{r.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {overrides.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground">Set apart</h3>
          <ul className="divide-y divide-border rounded-md border border-border">
            {overrides.map((o) => (
              <li key={o.scope} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{o.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {o.kind} · {levelLabel(o.level)}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => save(o.scope, null)}
                  aria-label={`Reset ${o.name}`}
                >
                  Reset
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
