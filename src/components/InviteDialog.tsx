"use client";

import { useRef, useState, useTransition } from "react";
import { UserPlus, X } from "lucide-react";
import { unstable_rethrow } from "next/navigation";
import { toast } from "sonner";
import { inviteAnyoneAction } from "@/app/actions";
import type { InvitationView } from "@/core/invitations";
import type { InvitePlace } from "@/core/invites";
import { LIST_ROLES, SPACE_ROLES, type ListRole, type SpaceRole } from "@/core/schema";
import { roleName } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ResponsiveDialog,
  ResponsiveDialogCloseButton,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { InvitedRow } from "./CheckInsView";
import { PlacePicker, placeKey as key, type PlaceGroup } from "./PlacePicker";
import { RoleSelect } from "./RoleSelect";
import { useDraft } from "./use-draft";
import { useStoredState } from "./use-stored-state";

type InviteSpaceRole = Exclude<SpaceRole, "admin">;
const SPACE_INVITE_ROLES = SPACE_ROLES.filter((r): r is InviteSpaceRole => r !== "admin");

/** Who's added and what's chosen: part of the draft, so a reload keeps it. */
type Picked = {
  people: string[];
  /** Chosen places, by key; a place keeps its role when unticked and ticked again. */
  places: string[];
  listRoles: Record<string, ListRole>;
  spaceRoles: Record<string, InviteSpaceRole>;
  /** Places, by key, where they'll see only your items. */
  onlyMine?: string[];
};
const NOTHING_PICKED: Picked = { people: [], places: [], listRoles: {}, spaceRoles: {} };

/** "Home", "Home and Life", "Home, Life and 2 more". */
function namesOf(names: string[]): string {
  if (names.length <= 2) return names.join(" and ");
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/** An email address rather than a username, such as someone not on Sidetrack yet. */
const isEmail = (handle: string) => handle.includes("@") && !handle.startsWith("@");

/**
 * Invite several people to several places at once: the Spaces the viewer
 * runs and the lists they own, each with its own role. One invite, so
 * everyone it reaches is notified of it together, and each person gets one email.
 * Places are optional: an email with no account gets a link to join
 * Sidetrack, bringing them into whatever's chosen, or nothing.
 */
export function InviteDialog({
  open,
  onOpenChange,
  groups,
  invited,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where they can be invited, grouped as on the board. */
  groups: PlaceGroup[];
  /** Links to join sent from here that nobody has accepted yet, to send again or cancel. */
  invited: InvitationView[];
}) {
  const draft = useDraft("invite:people");
  const person = draft.value;
  const [kept, setKept] = useStoredState("draft:invite:picked", NOTHING_PICKED);
  const { people, listRoles, spaceRoles } = kept;
  const picked = new Set(kept.places);
  const mine = new Set(kept.onlyMine ?? []);
  const setMine = (k: string, on: boolean) =>
    setKept((c) => ({
      ...c,
      onlyMine: on ? [...new Set([...(c.onlyMine ?? []), k])] : (c.onlyMine ?? []).filter((x) => x !== k),
    }));
  const setPeople = (next: (current: string[]) => string[]) =>
    setKept((c) => ({ ...c, people: next(c.people) }));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const personRef = useRef<HTMLInputElement>(null);

  /** Closes the dialog, dropping what's typed and chosen. */
  function close() {
    draft.clear();
    setKept(NOTHING_PICKED);
    setError(null);
    onOpenChange(false);
  }

  // Adds what's typed (one or more handles, split on commas or spaces).
  function addPeople(text: string) {
    const handles = text.split(/[\s,]+/).filter(Boolean);
    if (handles.length === 0) return;
    setPeople((current) => [...new Set([...current, ...handles])]);
    draft.set("");
  }

  function toggle(k: string, on: boolean) {
    setKept((c) => ({
      ...c,
      places: on ? [...new Set([...c.places, k])] : c.places.filter((p) => p !== k),
    }));
  }

  // In the order they're shown: each Space, then its lists.
  const chosen = groups.flatMap((g): { place: InvitePlace; name: string }[] => [
    ...(g.admin && picked.has(key({ kind: "space", id: g.id }))
      ? [
          {
            place: {
              kind: "space",
              id: g.id,
              role: spaceRoles[g.id] ?? "member",
              onlyMine: (spaceRoles[g.id] ?? "member") !== "member" && mine.has(key({ kind: "space", id: g.id })),
            } as const,
            name: g.name,
          },
        ]
      : []),
    ...g.lists
      .filter((l) => picked.has(key({ kind: "list", id: l.id })))
      .map((l) => ({
        place: {
          kind: "list",
          id: l.id,
          role: listRoles[l.id] ?? "editor",
          onlyMine: (listRoles[l.id] ?? "editor") !== "editor" && mine.has(key({ kind: "list", id: l.id })),
        } as const,
        name: l.name,
      })),
  ]);
  const places = chosen.map((c) => c.place);
  // What's typed but not yet added counts too, so Invite doesn't drop it.
  const everyone = [...new Set([...people, ...person.split(/[\s,]+/).filter(Boolean)])];
  // Without a place, only an email has something to accept: a link to join.
  const usernames = everyone.filter((p) => !isEmail(p));
  // Emails already sent a link to join: sending another is refused, so say so first.
  const pendingEmails = new Set(invited.map((i) => i.email.toLowerCase()));
  const already = everyone.filter((p) => pendingEmails.has(p.toLowerCase()));
  const ready = everyone.length > 0 && already.length === 0 && (places.length > 0 || usernames.length === 0);

  function invite() {
    if (!ready || pending) return;
    setError(null);
    start(async () => {
      let res: Awaited<ReturnType<typeof inviteAnyoneAction>>;
      try {
        res = await inviteAnyoneAction(everyone, places);
      } catch (err) {
        unstable_rethrow(err);
        res = { error: "Couldn't send the invites. Please try again." };
      }
      if (res.error !== undefined) return setError(res.error);
      const who = everyone.length === 1 ? everyone[0] : `${everyone.length} people`;
      toast.success(res.emailed?.length === everyone.length ? `Invite sent to ${who}` : `Invited ${who}`);
      close();
    });
  }

  /** What follows a ticked place: what they can do there. */
  const roleSelect = (kind: "space" | "list", id: string, name: string) => {
    const k = key({ kind, id });
    return kind === "space" ? (
      <RoleSelect
        label={`What they can do in ${name}`}
        value={spaceRoles[id] ?? "member"}
        roles={SPACE_INVITE_ROLES}
        scope="space"
        disabled={pending}
        onChange={(r) => setKept((c) => ({ ...c, spaceRoles: { ...c.spaceRoles, [id]: r } }))}
        onlyMine={{ value: mine.has(k), onChange: (on) => setMine(k, on) }}
      />
    ) : (
      <RoleSelect
        label={`What they can do on ${name}`}
        value={listRoles[id] ?? "editor"}
        roles={LIST_ROLES}
        scope="list"
        disabled={pending}
        onChange={(r) => setKept((c) => ({ ...c, listRoles: { ...c.listRoles, [id]: r } }))}
        onlyMine={{ value: mine.has(k), onChange: (on) => setMine(k, on) }}
      />
    );
  };

  return (
    // It stays open while it saves, so a failure shows where they're looking.
    <ResponsiveDialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : !pending && close())}>
      <ResponsiveDialogContent initialFocus={personRef}>
        <div className="flex shrink-0 flex-col gap-0.5 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <div className="flex items-center gap-2">
            <ResponsiveDialogTitle className="flex items-center gap-2">
              <UserPlus className="size-4 shrink-0 text-neutral-500" aria-hidden />
              Invite people
            </ResponsiveDialogTitle>
            <ResponsiveDialogCloseButton className="ml-auto shrink-0" />
          </div>
          <ResponsiveDialogDescription className="text-xs text-neutral-500">
            Invite them to lists and Spaces, choosing what they can do there,
            or just to Sidetrack. Anyone not on Sidetrack yet gets an email to join.
          </ResponsiveDialogDescription>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            invite();
          }}
          data-pending={pending || undefined}
          className="flex min-h-0 flex-1 flex-col data-pending:opacity-60"
        >
          <div className="shrink-0 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
            <Input
              ref={personRef}
              value={person}
              onChange={(e) => !pending && draft.set(e.target.value)}
              onKeyDown={(e) => {
                if (pending) return;
                if (e.key === "," || (e.key === "Enter" && person.trim())) {
                  e.preventDefault();
                  addPeople(person);
                } else if (e.key === "Backspace" && !person && people.length > 0) {
                  setPeople((c) => c.slice(0, -1));
                }
              }}
              onBlur={() => !pending && addPeople(person)}
              placeholder="Usernames or emails"
              aria-label="Who to invite"
              autoComplete="off"
              readOnly={pending}
            />
            {people.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="People to invite">
                {people.map((p) => (
                  <li
                    key={p}
                    className="flex items-center gap-1 rounded-full bg-neutral-100 py-0.5 pr-1 pl-2.5 text-xs dark:bg-neutral-800"
                  >
                    {p}
                    <button
                      type="button"
                      aria-label={`Don't invite ${p}`}
                      aria-disabled={pending || undefined}
                      onClick={() => !pending && setPeople((c) => c.filter((x) => x !== p))}
                      className="rounded-full p-0.5 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
                    >
                      <X className="size-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-3">
            <PlacePicker
              groups={groups}
              picked={picked}
              onToggle={toggle}
              disabled={pending}
              label={(name) => `Invite to ${name}`}
              empty="You can invite people to lists you own and Spaces you’re an admin of."
              trailing={(p, { on, spaceOn }) => {
                if (on) return roleSelect(p.kind, p.id, p.name);
                // Unticked, what they'd get here anyway from its Space being ticked.
                if (spaceOn) {
                  const space = groups.find((g) => g.lists.some((l) => l.id === p.id));
                  return (
                    <span className="shrink-0 px-2 text-xs text-neutral-500">
                      {roleName(spaceRoles[space?.id ?? ""] ?? "member")} via Space
                    </span>
                  );
                }
                return null;
              }}
            />
            {invited.length > 0 && (
              <section aria-label="Invited, not joined yet" className="mt-3 space-y-1 border-t border-neutral-200 px-2 pt-3 dark:border-neutral-800">
                <h3 className="pb-1 text-xs text-neutral-500">Invited, not joined yet</h3>
                {invited.map((i) => (
                  <InvitedRow key={i.id} invitation={i} />
                ))}
              </section>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-3 border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
            {error ? (
              <p role="alert" className="min-w-0 flex-1 text-xs text-red-600 dark:text-red-400">
                {error}
              </p>
            ) : (
              // Who hears of it: those invited, and those already in each
              // place who can comment or more (notifications.ts).
              <p className="line-clamp-2 min-w-0 flex-1 text-xs text-neutral-500">
                {everyone.length === 0
                  ? "Add who to invite."
                  : already.length > 0
                    ? `You’ve invited ${namesOf(already)} already. Send it again from Invited, not joined yet.`
                    : chosen.length === 0
                      ? usernames.length > 0
                        ? `Choose where to invite ${namesOf(usernames)}.`
                        : "We’ll email them a link to join Sidetrack. Nothing of yours is shared."
                      : // An email may or may not have an account yet; the server decides which.
                        everyone.length > usernames.length
                        ? `This will invite ${namesOf(everyone)} to ${namesOf(chosen.map((c) => c.name))}. Anyone not on Sidetrack yet gets an email to join first.`
                        : `This will notify ${namesOf(everyone)}, and the people already in ${namesOf(chosen.map((c) => c.name))}.`}
              </p>
            )}
            <Button type="submit" size="sm" aria-disabled={!ready || pending || undefined}>
              <UserPlus data-icon="inline-start" />
              {pending ? "Inviting…" : "Invite"}
            </Button>
          </div>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
