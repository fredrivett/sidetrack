"use client";

import { useRef, useState, useTransition } from "react";
import { UserPlus, X } from "lucide-react";
import { unstable_rethrow } from "next/navigation";
import { toast } from "sonner";
import { invitePeopleAction } from "@/app/actions";
import type { InvitePlace } from "@/core/invites";
import { LIST_ROLES, SPACE_ROLES, type ListRole, type SpaceRole } from "@/core/schema";
import { roleName } from "@/lib/roles";
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
import { ProjectIcon } from "./ProjectIcon";
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
  /** Places, by key, where they'll see only your items. */
  onlyMine?: string[];
};
const NOTHING_PICKED: Picked = { people: [], places: [], listRoles: {}, spaceRoles: {} };

/** A list the viewer owns, as the dialog shows it. */
type InviteList = { id: string; name: string; icon: string | null; homepageUrl: string | null };

// A tree line from a Space's checkbox down to each of its lists, bending into
// it, as sub-items hang off their parent on the board (ItemList's BRANCH and
// TRUNK). Row maths: lists sit 28px in (pl-7) and 2px apart (space-y-0.5,
// mt-0.5); a row is 40px tall with its checkbox's centre 16px in (px-2 plus
// half of 16px). So the line runs 13px left of a row, and bends into its
// middle from the gap above; the first list's reaches up into the Space's
// row to 4px under its checkbox (which ends 12px above the row's foot), so
// the line hangs off it whether or not the row is shaded.
const BRANCH =
  "relative before:absolute before:-left-[13px] before:w-[13px] before:rounded-bl-lg before:border-b-2 before:border-l-2 before:border-neutral-200 dark:before:border-neutral-700";
const TRUNK =
  "after:absolute after:top-0 after:-bottom-0.5 after:-left-[13px] after:border-l-2 after:border-neutral-200 dark:after:border-neutral-700";

/** "Home", "Home and Life", "Home, Life and 2 more". */
function namesOf(names: string[]): string {
  if (names.length <= 2) return names.join(" and ");
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/**
 * Invite several people to several places at once: the Spaces the viewer
 * runs and the lists they own, each with its own role. One invite, so
 * everyone it reaches is notified of it together, and each person gets one email.
 */
export function InviteDialog({
  open,
  onOpenChange,
  groups,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Where they can be invited, grouped as on the board: each Space with the
   * viewer's own lists in it, then Personal. An `admin` Space can be invited
   * to whole; any other group only heads its lists.
   */
  groups: { id: string; name: string; icon: string | null; admin: boolean; lists: InviteList[] }[];
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

  /** One place to tick: a Space (its group's heading) or a list in it. */
  const row = ({
    kind,
    id,
    name,
    icon,
    homepageUrl = null,
    select,
    covered,
    tree = "",
  }: {
    kind: "space" | "list";
    id: string;
    name: string;
    icon: string | null;
    homepageUrl?: string | null;
    select: React.ReactNode;
    /** Unticked, what they'd get here anyway from its Space being ticked. */
    covered?: string;
    /** The tree line's classes, for a list under its Space. */
    tree?: string;
  }) => {
    const k = key({ kind, id });
    const on = picked.has(k);
    return (
      <li
        key={k}
        data-on={on || undefined}
        className={`${tree} flex min-h-10 items-center justify-between gap-2 rounded-lg px-2 py-1 hover:bg-neutral-100 data-on:bg-neutral-100 dark:hover:bg-neutral-800/70 dark:data-on:bg-neutral-800/70`}
      >
        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 self-stretch text-sm">
          <Checkbox
            checked={on}
            onCheckedChange={(checked) => !pending && toggle(k, checked)}
            aria-disabled={pending || undefined}
            aria-label={`Invite to ${name}`}
          />
          <ProjectIcon icon={icon} homepageUrl={homepageUrl} name={name} size={16} />
          <span className={`truncate ${kind === "space" ? "font-medium" : ""}`}>{name}</span>
          {kind === "space" && (
            <span className="shrink-0 text-xs text-neutral-500">Whole Space</span>
          )}
        </label>
        {on ? (
          select
        ) : covered ? (
          <span className="shrink-0 px-2 text-xs text-neutral-500">{covered} via Space</span>
        ) : null}
      </li>
    );
  };

  const listRow = (l: InviteList, covered: string | undefined, tree: string) =>
    row({
      kind: "list",
      ...l,
      covered,
      tree,
      select: (
        <RoleSelect
          label={`What they can do on ${l.name}`}
          value={listRoles[l.id] ?? "editor"}
          roles={LIST_ROLES}
          scope="list"
          disabled={pending}
          onChange={(r) => setKept((c) => ({ ...c, listRoles: { ...c.listRoles, [l.id]: r } }))}
          onlyMine={{
            value: mine.has(key({ kind: "list", id: l.id })),
            onChange: (on) => setMine(key({ kind: "list", id: l.id }), on),
          }}
        />
      ),
    });

  const nothingToShare = groups.every((g) => !g.admin && g.lists.length === 0);
  // Without Spaces, the lists are one group with nothing to head it.
  const flat = groups.length === 1 && !groups[0].admin;

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
            Choose where to invite them and what they can do there. They’ll
            need a Sidetrack account, and see nothing until they accept.
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
              placeholder="Usernames or emails"
              aria-label="Who to invite"
              autoComplete="off"
              readOnly={pending}
            />
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-2 py-3">
            {nothingToShare && (
              <p className="py-6 text-center text-xs text-neutral-500">
                You can invite people to lists you own and Spaces you’re an admin of.
              </p>
            )}
            {!nothingToShare &&
              groups.map((g) => {
                const spaceOn = g.admin && picked.has(key({ kind: "space", id: g.id }));
                const covered = spaceOn ? roleName(spaceRoles[g.id] ?? "member") : undefined;
                return (
                  <section key={g.id} aria-label={flat ? undefined : g.name}>
                    {flat ? null : g.admin ? (
                      <ul>
                        {row({
                          kind: "space",
                          id: g.id,
                          name: g.name,
                          icon: g.icon,
                          select: (
                            <RoleSelect
                              label={`What they can do in ${g.name}`}
                              value={spaceRoles[g.id] ?? "member"}
                              roles={SPACE_INVITE_ROLES}
                              scope="space"
                              disabled={pending}
                              onChange={(r) =>
                                setKept((c) => ({ ...c, spaceRoles: { ...c.spaceRoles, [g.id]: r } }))
                              }
                              onlyMine={{
                                value: mine.has(key({ kind: "space", id: g.id })),
                                onChange: (on) => setMine(key({ kind: "space", id: g.id }), on),
                              }}
                            />
                          ),
                        })}
                      </ul>
                    ) : (
                      <h3 className="px-2 pb-1 text-xs font-medium text-neutral-500">{g.name}</h3>
                    )}
                    {g.lists.length > 0 && (
                      // A Space's lists hang off it on a tree line, so they read as its.
                      <ul className={g.admin ? "mt-0.5 space-y-0.5 pl-7" : "space-y-0.5"}>
                        {g.lists.map((l, i) =>
                          listRow(
                            l,
                            covered,
                            g.admin
                              ? `${BRANCH} ${i === 0 ? "before:-top-2.5 before:h-[31px]" : "before:-top-0.5 before:h-[23px]"} ${i < g.lists.length - 1 ? TRUNK : ""}`
                              : "",
                          ),
                        )}
                      </ul>
                    )}
                  </section>
                );
              })}
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
                {chosen.length === 0
                  ? "Choose where to invite them."
                  : everyone.length === 0
                    ? "Add who to invite."
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
