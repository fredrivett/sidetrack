"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { HeartHandshake, Mail } from "lucide-react";
import { unstable_rethrow } from "next/navigation";
import { inviteByEmailAction, invitePeopleAction, alreadySharedAction, shareDayAction } from "@/app/actions";
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
import { BRANCH, PlacePicker, pickedPlaces, type PlaceGroup, TRUNK } from "./PlacePicker";
import { ProjectIcon } from "./ProjectIcon";
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
 * stays yours. The lists they already see whole show ticked and locked:
 * your day there is included anyway (dayOnWholeLists), so with any of those
 * you needn't pick more (shareDay). Underneath, a place picked is an invite
 * to it, limited to your items and the window; they accept the whole day at
 * once, on Check-ins.
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
  const who = draft.value.trim();
  // The lists they already see whole that you're on, for who's typed now.
  type Already = Awaited<ReturnType<typeof alreadySharedAction>>;
  const [already, setAlready] = useState<{ for: string } & Already | null>(null);
  const shared = already?.for === who ? already.lists : [];
  const sharedSpaces = already?.for === who ? already.spaces : [];
  useEffect(() => {
    if (!open || !who) return;
    let stale = false;
    const t = setTimeout(async () => {
      let found: Already = { spaces: [], lists: [] };
      try {
        found = await alreadySharedAction(who);
      } catch (err) {
        // Only advice: without it, they pick places as before.
        unstable_rethrow(err);
      }
      if (!stale) setAlready({ for: who, ...found });
    }, 250);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [open, who]);
  // Those aren't theirs to pick: they're shown as included instead.
  // A Space they're in already can't be picked whole either.
  const sharedIds = new Set([...shared, ...sharedSpaces].map((l) => l.id));
  const pickable = groups
    .map((g) => ({ ...g, admin: g.admin && !sharedIds.has(g.id), lists: g.lists.filter((l) => !sharedIds.has(l.id)) }))
    .filter((g) => g.admin || g.lists.length > 0);
  const chosen = pickedPlaces(pickable, picked);
  const invitingNow = stranger !== null && stranger === who;
  // Something has to be shared: a place picked, or one already shared (not by email: they share nothing yet).
  const ready = who !== "" && (chosen.length > 0 || (!invitingNow && shared.length > 0));
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
    const inviting = invitingNow;
    setError(null);
    start(async () => {
      let refused: string | undefined;
      try {
        const res: { error: string; notOnSidetrack?: string[] } | undefined = inviting
          ? await inviteByEmailAction(who, places)
          : places.length === 0
            ? await shareDayAction(who, { within: kept.within, note: kept.note, mood: kept.mood })
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
            On their Check-ins, once they accept, they’ll see your items on lists you already share
            with them and the ones you pick, and can comment on those you pick. Nothing else on those.
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
            {shared.length > 0 && !invitingNow && (
              <section aria-label="Already shared, included">
                <h3 className="px-2 pb-1 text-xs font-medium text-neutral-500">Already shared, included</h3>
                <ul className="space-y-0.5">
                  {sharedSpaces.map((sp) => {
                    const inIt = shared.filter((l) => l.spaceId === sp.id);
                    return (
                      <li key={sp.id}>
                        <LockedRow place={{ ...sp, homepageUrl: null }} space />
                        {/* Its lists hang off it on a tree line, as in the picker below. */}
                        <ul className="mt-0.5 space-y-0.5 pl-7">
                          {inIt.map((l, i) => (
                            <li
                              key={l.id}
                              className={`${BRANCH} ${i === 0 ? "before:-top-2.5 before:h-[31px]" : "before:-top-0.5 before:h-[23px]"} ${i < inIt.length - 1 ? TRUNK : ""}`}
                            >
                              <LockedRow place={l} />
                            </li>
                          ))}
                        </ul>
                      </li>
                    );
                  })}
                  {shared
                    .filter((l) => !l.spaceId)
                    .map((l) => (
                      <li key={l.id}>
                        <LockedRow place={l} />
                      </li>
                    ))}
                </ul>
                <h3 className="px-2 pt-3 pb-1 text-xs font-medium text-neutral-500">Also share from</h3>
              </section>
            )}
            <PlacePicker
              groups={pickable}
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
                {!who
                  ? "Add who to share it with."
                  : chosen.length + shared.length === 0
                    ? "Choose where your day comes from."
                    : `${who} will see your ${span} on ${namesOf([...shared, ...chosen].map((c) => c.name))}.`}
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

/** A place they already see whole: ticked, and not theirs to untick here. */
function LockedRow({
  place,
  space = false,
}: {
  place: { name: string; icon: string | null; homepageUrl: string | null };
  space?: boolean;
}) {
  return (
    <div className="flex min-h-10 items-center gap-2.5 rounded-lg px-2 py-1 text-sm">
      <Checkbox checked aria-disabled aria-label={`Already shared: ${place.name}`} />
      <ProjectIcon icon={place.icon} homepageUrl={place.homepageUrl} name={place.name} size={16} />
      <span className={`truncate text-neutral-600 dark:text-neutral-400 ${space ? "font-medium" : ""}`}>{place.name}</span>
      {space && <span className="shrink-0 text-xs text-neutral-500">Whole Space</span>}
    </div>
  );
}
