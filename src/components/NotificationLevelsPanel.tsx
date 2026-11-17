"use client";

import { unstable_rethrow, useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { useState, useTransition } from "react";
import { setNotificationLevelAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { NotificationLevel } from "@/core/schema";
import { LEVELS, levelLabel } from "./notification-levels";

/**
 * How much the viewer hears: their level for everything, and the Spaces and
 * lists they've set apart from it, set from those menus and reset here.
 */
// Due reminders' own choices, stored as levels for the "reminders" scope.
const REMINDERS: Array<{ level: NotificationLevel; label: string; hint: string }> = [
  { level: "all", label: "Notify me", hint: "At 8am: what's due that day, and what's still open from yesterday." },
  { level: "default", label: "Inbox only", hint: "At 8am, in your inbox, without a notification." },
  { level: "mine", label: "Off", hint: "No due reminders." },
];

// What isn't a person's doing has its own choices, stored as levels for
// the "agents" scope.
const AGENTS: Array<{ level: NotificationLevel; label: string; hint: string }> = [
  { level: "all", label: "Same as people", hint: "Notified like people's activity." },
  { level: "default", label: "Inbox only", hint: "Waits in your inbox. What's for you still notifies." },
  { level: "mine", label: "Only for me", hint: "Only when they assign or mention you." },
];

export function NotificationLevelsPanel({
  level,
  reminders,
  agents,
  overrides,
}: {
  /** Their level for everything. */
  level: NotificationLevel;
  /** How they hear due reminders. */
  reminders: NotificationLevel;
  /** How they hear what other people's agents, GitHub and Sidetrack do. */
  agents: NotificationLevel;
  /** Spaces and lists with a level of their own. */
  overrides: Array<{ scope: string; name: string; kind: "Space" | "List"; level: NotificationLevel }>;
}) {
  const router = useRouter();
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

  const rows: Array<{
    scope: string;
    title: string;
    value: NotificationLevel;
    options: typeof LEVELS;
    about?: string;
  }> = [
    { scope: "all", title: "Activity on your lists", value: level, options: LEVELS },
    {
      scope: "agents",
      title: "Activity by agents",
      value: agents,
      options: AGENTS,
      about:
        "Other people's agents, GitHub and Sidetrack itself. Your own agents notify you only when they finish or something's for you.",
    },
    { scope: "reminders", title: "Due reminders", value: reminders, options: REMINDERS },
  ];

  return (
    <div
      className="space-y-4 rounded-lg border border-border p-4 aria-disabled:opacity-60"
      aria-disabled={pending || undefined}
    >
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.scope} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="text-sm font-medium">{r.title}</p>
              <p className="text-xs text-muted-foreground">
                {r.options.find((o) => o.level === r.value)?.hint}
              </p>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={r.title}
                aria-disabled={pending || undefined}
                className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-sm transition hover:bg-accent aria-disabled:pointer-events-none"
              >
                {r.options.find((o) => o.level === r.value)?.label}
                <ChevronDown className="size-4 opacity-50" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                {r.about && (
                  <p className="px-1.5 pt-1 pb-2 text-xs text-muted-foreground">{r.about}</p>
                )}
                <DropdownMenuRadioGroup
                  value={r.value}
                  onValueChange={(next: string) =>
                    next !== r.value && save(r.scope, next as NotificationLevel)
                  }
                >
                  {r.options.map((o) => (
                    <DropdownMenuRadioItem key={o.level} value={o.level} closeOnClick>
                      <span className="space-y-0.5">
                        <span className="block">{o.label}</span>
                        <span className="block text-xs text-muted-foreground">{o.hint}</span>
                      </span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        ))}
      </ul>

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

      <p className="text-xs text-muted-foreground">
        Set a Space or list apart in its ⋯ menu, under Notifications.
      </p>
    </div>
  );
}
