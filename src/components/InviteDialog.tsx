"use client";

import { useRef, useState, useTransition } from "react";
import { UserPlus, X } from "lucide-react";
import { unstable_rethrow } from "next/navigation";
import { toast } from "sonner";
import { invitePeopleAction } from "@/app/actions";
import type { InvitePlace } from "@/core/invites";
import { LIST_ROLES, SPACE_ROLES, type ListRole, type SpaceRole } from "@/core/schema";
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
import { RoleSelect } from "./RoleSelect";
import { useDraft } from "./use-draft";
import { useStoredState } from "./use-stored-state";

type InviteSpaceRole = Exclude<SpaceRole, "admin">;
const SPACE_INVITE_ROLES = SPACE_ROLES.filter((r): r is InviteSpaceRole => r !== "admin");

const key = (p: { kind: string; id: string }) => `${p.kind}:${p.id}`;

/** Who's added and what's chosen: part of the draft, so a reload keeps it. */
type Picked = {
  people: string[];
  /** Chosen places, by key; a place keeps its role when unticked and ticked again. */
  places: string[];
  listRoles: Record<string, ListRole>;
  spaceRoles: Record<string, InviteSpaceRole>;
};
const NOTHING_PICKED: Picked = { people: [], places: [], listRoles: {}, spaceRoles: {} };

/**
 * Invite several people to several places at once: the Spaces the viewer
 * runs and the lists they own, each with its own role. One invite, so
 * everyone it reaches is notified of it together, and each person gets one email.
 */
export function InviteDialog({
  open,
  onOpenChange,
  spaces,
  lists,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Spaces the viewer can invite to (they're an admin). */
  spaces: { id: string; name: string }[];
  /** Lists the viewer can invite to (they own them). */
  lists: { id: string; name: string }[];
}) {
  const draft = useDraft("invite:people");
  const person = draft.value;
  const [kept, setKept] = useStoredState("draft:invite:picked", NOTHING_PICKED);
  const { people, listRoles, spaceRoles } = kept;
  const picked = new Set(kept.places);
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

  const places: InvitePlace[] = [
    ...spaces
      .filter((s) => picked.has(key({ kind: "space", id: s.id })))
      .map((s): InvitePlace => ({ kind: "space", id: s.id, role: spaceRoles[s.id] ?? "member" })),
    ...lists
      .filter((l) => picked.has(key({ kind: "list", id: l.id })))
      .map((l): InvitePlace => ({ kind: "list", id: l.id, role: listRoles[l.id] ?? "editor" })),
  ];
  // What's typed but not yet added counts too, so Invite doesn't drop it.
  const everyone = [...new Set([...people, ...person.split(/[\s,]+/).filter(Boolean)])];
  const ready = everyone.length > 0 && places.length > 0;

  function invite() {
    if (!ready || pending) return;
    setError(null);
    start(async () => {
      try {
        await invitePeopleAction(everyone, places);
      } catch (err) {
        unstable_rethrow(err);
        setError(err instanceof Error ? err.message : "Couldn't send the invites.");
        return;
      }
      toast.success(
        `Invited ${everyone.length === 1 ? everyone[0] : `${everyone.length} people`}`,
      );
      close();
    });
  }

  const row = (
    kind: "space" | "list",
    place: { id: string; name: string },
    select: React.ReactNode,
  ) => {
    const k = key({ kind, id: place.id });
    const on = picked.has(k);
    return (
      <li
        key={k}
        className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-sm">
          <Checkbox
            checked={on}
            onCheckedChange={(checked) => !pending && toggle(k, checked)}
            aria-disabled={pending || undefined}
            aria-label={`Invite to ${place.name}`}
          />
          <span className="truncate">{place.name}</span>
        </label>
        {on && select}
      </li>
    );
  };

  const nothingToShare = spaces.length === 0 && lists.length === 0;

  return (
    // It stays open while it saves, so a failure shows where they're looking.
    <ResponsiveDialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : !pending && close())}>
      <ResponsiveDialogContent initialFocus={personRef}>
        <div className="flex shrink-0 flex-col gap-0.5 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <div className="flex items-center gap-2">
            <ResponsiveDialogTitle>Invite people</ResponsiveDialogTitle>
            <ResponsiveDialogCloseButton className="ml-auto shrink-0" />
          </div>
          <ResponsiveDialogDescription className="text-xs text-neutral-500">
            Invite people to several Spaces and lists at once, choosing what
            they can do in each. They’ll need a Sidetrack account and must
            accept before they can see them.
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
            {people.length > 0 && (
              <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="People to invite">
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
              placeholder="usernames or emails"
              aria-label="Who to invite"
              autoComplete="off"
              readOnly={pending}
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
            {nothingToShare && (
              <p className="py-6 text-center text-xs text-neutral-500">
                You can invite people to lists you own and Spaces you’re an admin of.
              </p>
            )}
            {spaces.length > 0 && (
              <section>
                <h3 className="px-2 pb-1 text-xs font-medium text-neutral-500">Spaces</h3>
                <ul className="space-y-1">
                  {spaces.map((s) =>
                    row(
                      "space",
                      s,
                      <RoleSelect
                        label={`What they can do in ${s.name}`}
                        value={spaceRoles[s.id] ?? "member"}
                        roles={SPACE_INVITE_ROLES}
                        scope="space"
                        disabled={pending}
                        onChange={(r) => setKept((c) => ({ ...c, spaceRoles: { ...c.spaceRoles, [s.id]: r } }))}
                      />,
                    ),
                  )}
                </ul>
              </section>
            )}
            {lists.length > 0 && (
              <section className={spaces.length > 0 ? "mt-4" : undefined}>
                <h3 className="px-2 pb-1 text-xs font-medium text-neutral-500">Lists</h3>
                <ul className="space-y-1">
                  {lists.map((l) =>
                    row(
                      "list",
                      l,
                      <RoleSelect
                        label={`What they can do on ${l.name}`}
                        value={listRoles[l.id] ?? "editor"}
                        roles={LIST_ROLES}
                        scope="list"
                        disabled={pending}
                        onChange={(r) => setKept((c) => ({ ...c, listRoles: { ...c.listRoles, [l.id]: r } }))}
                      />,
                    ),
                  )}
                </ul>
              </section>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2 border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
            {error ? (
              <p role="alert" className="min-w-0 flex-1 text-xs text-red-600 dark:text-red-400">
                {error}
              </p>
            ) : (
              <p className="min-w-0 flex-1 text-xs text-neutral-500">
                {places.length === 0
                  ? "Choose where to invite them."
                  : `${places.length} ${places.length === 1 ? "place" : "places"} chosen`}
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
