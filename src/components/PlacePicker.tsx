"use client";

import type { ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { ProjectIcon } from "./ProjectIcon";

/** A list the viewer can pick, as a picker shows it; `unavailable` says why it's shown but can't be. */
export type PlaceList = { id: string; name: string; icon: string | null; homepageUrl: string | null; unavailable?: string };

/**
 * Places grouped as on the board: each Space with the viewer's own lists in
 * it, then Personal. An `admin` Space can be picked whole; any other group
 * only heads its lists.
 */
export type PlaceGroup = { id: string; name: string; icon: string | null; admin: boolean; lists: PlaceList[] };

/** A place, as picked: a whole Space or one list. */
export type Place = { kind: "space" | "list"; id: string; name: string };

export const placeKey = (p: { kind: string; id: string }) => `${p.kind}:${p.id}`;

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

/** The places in `groups` that are picked, in the order they're shown: each Space, then its lists. */
export function pickedPlaces(groups: PlaceGroup[], picked: ReadonlySet<string>): Place[] {
  return groups.flatMap((g): Place[] => [
    ...(g.admin && picked.has(placeKey({ kind: "space", id: g.id })) ? [{ kind: "space" as const, id: g.id, name: g.name }] : []),
    ...g.lists
      .filter((l) => !l.unavailable && picked.has(placeKey({ kind: "list", id: l.id })))
      .map((l) => ({ kind: "list" as const, id: l.id, name: l.name })),
  ]);
}

/**
 * The Spaces the viewer runs and the lists they own, to tick, as Invite
 * people and Share my day both offer them. What follows a row (a role to
 * choose, or what its Space already gives) is the dialog's.
 */
export function PlacePicker({
  groups,
  picked,
  onToggle,
  disabled,
  label,
  trailing,
  empty,
}: {
  groups: PlaceGroup[];
  picked: ReadonlySet<string>;
  onToggle: (key: string, on: boolean) => void;
  disabled: boolean;
  /** Each checkbox's accessible name, such as `Invite to ${name}`. */
  label: (name: string) => string;
  /** What ends a row: `on` if it's ticked, `spaceOn` if its Space is. */
  trailing: (place: Place, state: { on: boolean; spaceOn: boolean }) => ReactNode;
  /** Shown when there's nothing to pick. */
  empty: string;
}) {
  const row = (place: Place & { icon: string | null; homepageUrl?: string | null; unavailable?: string }, spaceOn: boolean, tree = "") => {
    const k = placeKey(place);
    const off = Boolean(place.unavailable);
    const on = !off && picked.has(k);
    return (
      <li
        key={k}
        data-on={on || undefined}
        className={`${tree} flex min-h-10 items-center justify-between gap-2 rounded-lg px-2 py-1 data-on:bg-neutral-100 dark:data-on:bg-neutral-800/70 ${off ? "" : "hover:bg-neutral-100 dark:hover:bg-neutral-800/70"}`}
      >
        <label className={`flex min-w-0 flex-1 items-center gap-2.5 self-stretch text-sm ${off ? "opacity-50" : "cursor-pointer"}`}>
          <Checkbox
            checked={on}
            onCheckedChange={(checked) => !disabled && !off && onToggle(k, checked)}
            aria-disabled={disabled || off || undefined}
            aria-label={label(place.name)}
            aria-description={place.unavailable}
          />
          <ProjectIcon icon={place.icon} homepageUrl={place.homepageUrl ?? null} name={place.name} size={16} />
          <span className={`truncate ${place.kind === "space" ? "font-medium" : ""}`}>{place.name}</span>
          {place.kind === "space" && <span className="shrink-0 text-xs text-neutral-500">Whole Space</span>}
        </label>
        {off ? (
          <span className="shrink-0 text-xs text-neutral-500">{place.unavailable}</span>
        ) : (
          trailing({ kind: place.kind, id: place.id, name: place.name }, { on, spaceOn })
        )}
      </li>
    );
  };

  if (groups.every((g) => !g.admin && g.lists.length === 0)) {
    return <p className="py-6 text-center text-xs text-neutral-500">{empty}</p>;
  }
  // Without Spaces, the lists are one group with nothing to head it.
  const flat = groups.length === 1 && !groups[0].admin;

  return (
    <div className="space-y-4">
      {groups.map((g) => {
        const spaceOn = g.admin && picked.has(placeKey({ kind: "space", id: g.id }));
        return (
          <section key={g.id} aria-label={flat ? undefined : g.name}>
            {flat ? null : g.admin ? (
              <ul>{row({ kind: "space", id: g.id, name: g.name, icon: g.icon }, false)}</ul>
            ) : (
              <h3 className="px-2 pb-1 text-xs font-medium text-neutral-500">{g.name}</h3>
            )}
            {g.lists.length > 0 && (
              // A Space's lists hang off it on a tree line, so they read as its.
              <ul className={g.admin ? "mt-0.5 space-y-0.5 pl-7" : "space-y-0.5"}>
                {g.lists.map((l, i) =>
                  row(
                    { kind: "list", ...l },
                    spaceOn,
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
  );
}
