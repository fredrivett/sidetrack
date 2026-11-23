"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { HeartHandshake, Mail } from "lucide-react";
import { unstable_rethrow } from "next/navigation";
import { inviteByEmailAction, invitePeopleAction } from "@/app/actions";
import type { InvitePlace } from "@/core/invites";
import type { OnlyWithin } from "@/core/schema";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  ResponsiveDialog,
  ResponsiveDialogCloseButton,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { PlacePicker, pickedPlaces, type PlaceGroup } from "./PlacePicker";
import { useDraft } from "./use-draft";
import { useStoredState } from "./use-stored-state";

/** What's picked: part of the draft, so a reload keeps it. */
type Picked = { places: string[]; within: OnlyWithin; note: boolean; mood: boolean };
const NOTHING_PICKED: Picked = { places: [], within: "today", note: false, mood: false };

/** "Home", "Home and Life", "Home, Life and 2 more". */
function namesOf(names: string[]): string {
  if (names.length <= 2) return names.join(" and ");
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/**
 * Share your today or week with one person, across the lists and Spaces you
 * pick: they see only your items there, in that window, on their Check-ins,
 * and can comment. Nothing is shared until you pick it, so a personal list
 * stays yours. Underneath it's an invite to each place, limited to your
 * items and the window, which they accept as usual.
 */
export function ShareDayDialog({
  open,
  person: suggested,
  onOpenChange,
  groups,
}: {
  open: boolean;
  /** Someone to share it with, already filled in, such as when sharing back. */
  person: string | null;
  onOpenChange: (open: boolean) => void;
  /** The lists on your board and Spaces you run, grouped as Invite people shows them; those you can't edit are `unavailable`. */
  groups: PlaceGroup[];
}) {
  const draft = useDraft("share-day:person");
  const [kept, setKept] = useStoredState("draft:share-day:picked", NOTHING_PICKED);
  const picked = new Set(kept.places);
  const [error, setError] = useState<string | null>(null);
  // Who they typed has no account: the dialog offers to email them an
  // invite instead, which shares the day once they join.
  const [stranger, setStranger] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const personRef = useRef<HTMLInputElement>(null);
  const chosen = pickedPlaces(groups, picked);
  const who = draft.value.trim();
  const ready = who !== "" && chosen.length > 0;
  // Sharing back fills in who with; anything typed already stays.
  const { set: setPerson } = draft;
  useEffect(() => {
    if (open && suggested) setPerson((cur) => cur || suggested);
  }, [open, suggested, setPerson]);

  function close(next: boolean) {
    if (pending) return;
    if (!next) {
      draft.clear();
      setKept(NOTHING_PICKED);
      setError(null);
      setStranger(null);
    }
    onOpenChange(next);
  }

  function share() {
    if (pending || !ready) return;
    const places: InvitePlace[] = chosen.map((p) =>
        p.kind === "list"
          ? { kind: "list", id: p.id, role: "commenter", onlyMine: true, within: kept.within, shareNote: kept.note, shareMood: kept.mood }
          : { kind: "space", id: p.id, role: "commenter", onlyMine: true, within: kept.within, shareNote: kept.note, shareMood: kept.mood },
      );
    // Inviting someone not on Sidetrack yet, once they've said to.
    const inviting = stranger !== null && stranger === who;
    setError(null);
    start(async () => {
      let refused: string | undefined;
      try {
        const res: { error: string; notOnSidetrack?: string[] } | undefined = inviting
          ? await inviteByEmailAction(who, places)
          : await invitePeopleAction([who], places);
        if (res?.notOnSidetrack?.length) return setStranger(who);
        refused = res?.error;
      } catch (err) {
        unstable_rethrow(err);
        refused = inviting ? "Couldn't send the invite. Please try again." : "Couldn't share your day. Please try again.";
      }
      if (refused) return setError(refused);
      if (inviting) toast.success(`Invite sent to ${who}`);
      setStranger(null);
      draft.clear();
      setKept(NOTHING_PICKED);
      onOpenChange(false);
    });
  }

  const span = kept.within === "today" ? "day" : "week";
  // Still the address that had no account; typing someone else starts over.
  const invitingNow = stranger !== null && stranger === who;

  return (
    // It stays open while it saves, so a failure shows where they're looking.
    <ResponsiveDialog open={open} onOpenChange={close}>
      <ResponsiveDialogContent initialFocus={personRef}>
        <div className="flex shrink-0 flex-col gap-0.5 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <div className="flex items-center gap-2">
            <ResponsiveDialogTitle className="flex items-center gap-2">
              <HeartHandshake className="size-4 shrink-0 text-neutral-500" aria-hidden />
              Share my day
            </ResponsiveDialogTitle>
            <ResponsiveDialogCloseButton className="ml-auto shrink-0" />
          </div>
          <ResponsiveDialogDescription className="text-xs text-neutral-500">
            On their Check-ins, they’ll see your items on the lists you pick and on lists you
            already share with them, and can comment on the lists you pick. Nothing else on those.
          </ResponsiveDialogDescription>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            share();
          }}
          data-pending={pending || undefined}
          className="flex min-h-0 flex-1 flex-col data-pending:opacity-60"
        >
          <div className="shrink-0 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
            <Input
              ref={personRef}
              value={draft.value}
              onChange={(e) => {
                if (pending) return;
                draft.set(e.target.value);
                setError(null);
              }}
              readOnly={pending}
              placeholder="Their username or email"
              aria-label="Who to share your day with"
              autoComplete="off"
            />
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-2 py-3">
            <div role="radiogroup" aria-label="How much" className="flex gap-2 px-2">
              {(
                [
                  ["today", "Today"],
                  ["week", "This week"],
                ] as const
              ).map(([w, label]) => (
                <Button
                  key={w}
                  type="button"
                  role="radio"
                  aria-checked={kept.within === w}
                  aria-disabled={pending || undefined}
                  variant={kept.within === w ? "default" : "outline"}
                  size="sm"
                  onClick={() => !pending && setKept((c) => ({ ...c, within: w }))}
                >
                  {label}
                </Button>
              ))}
            </div>
            <PlacePicker
              groups={groups}
              picked={picked}
              onToggle={(k, on) =>
                setKept((c) => ({ ...c, places: on ? [...new Set([...c.places, k])] : c.places.filter((x) => x !== k) }))
              }
              disabled={pending}
              label={(name) => `Share from ${name}`}
              empty="You can share your day from lists you own and Spaces you’re an admin of."
              // A list in a ticked Space is covered by it already.
              trailing={(_, { on, spaceOn }) =>
                !on && spaceOn ? <span className="shrink-0 px-2 text-xs text-neutral-500">Included via Space</span> : null
              }
            />
            <section aria-label="Also share">
              <h3 className="px-2 pb-1 text-xs font-medium text-neutral-500">Also share</h3>
              <ul className="space-y-0.5">
                {(
                  [
                    ["mood", "How today feels", "The mood you tap under your day note"],
                    ["note", "My day note", "What you write about your day"],
                  ] as const
                ).map(([k, label, hint]) => (
                  <li
                    key={k}
                    data-on={kept[k] || undefined}
                    className="flex min-h-10 items-center rounded-lg px-2 py-1 hover:bg-neutral-100 data-on:bg-neutral-100 dark:hover:bg-neutral-800/70 dark:data-on:bg-neutral-800/70"
                  >
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 self-stretch text-sm">
                      <Checkbox
                        checked={!!kept[k]}
                        aria-disabled={pending || undefined}
                        onCheckedChange={(on) => !pending && setKept((c) => ({ ...c, [k]: on === true }))}
                      />
                      <span className="min-w-0">
                        <span className="block">{label}</span>
                        <span className="block text-xs text-neutral-500">{hint}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <div className="flex shrink-0 items-center gap-3 border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
            {error ? (
              <p role="alert" className="min-w-0 flex-1 text-xs text-red-600 dark:text-red-400">
                {error}
              </p>
            ) : invitingNow ? (
              <p role="status" className="min-w-0 flex-1 text-xs">
                <span className="block font-medium">{who} isn’t on Sidetrack yet.</span>
                <span className="block text-neutral-500">
                  We’ll email them an invite. Your {span} shows on their Check-ins once they join.
                </span>
              </p>
            ) : (
              <p className="line-clamp-2 min-w-0 flex-1 text-xs text-neutral-500">
                {chosen.length === 0
                  ? "Choose where your day comes from."
                  : !who
                    ? "Add who to share it with."
                    : `${who} will see your ${span} on ${namesOf(chosen.map((c) => c.name))}.`}
              </p>
            )}
            <Button type="submit" size="sm" aria-disabled={!ready || pending || undefined}>
              {invitingNow ? <Mail data-icon="inline-start" /> : <HeartHandshake data-icon="inline-start" />}
              {invitingNow ? (pending ? "Sending…" : "Email an invite") : pending ? "Sharing…" : `Share my ${span}`}
            </Button>
          </div>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
