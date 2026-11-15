"use client";

import { Boxes, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import {
  createSpaceAction,
  deleteSpaceAction,
  inviteSpaceMemberAction,
  listSpaceMembersAction,
  listSuggestedSpaceMembersAction,
  removeSpaceMemberAction,
  setSpaceMemberRoleAction,
  updateSpaceAction,
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CollaboratorView } from "@/core/members";
import type { SpaceMemberView, SpaceView } from "@/core/spaces";
import { EditableText } from "./EditableText";
import { runAction } from "./run-action";
import { useTapToConfirm } from "./use-tap-to-confirm";

function displayName(m: CollaboratorView) {
  return m.displayUsername ? `@${m.displayUsername}` : (m.name ?? m.email ?? m.userId);
}

const BADGE =
  "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide";

/** The viewer's Spaces, and a form to start one. */
export function SpacesPanel({ spaces, viewerId }: { spaces: SpaceView[]; viewerId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pending, start] = useTransition();

  function create(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    start(async () => {
      if (await runAction(createSpaceAction({ name: trimmed }), "create the space")) {
        setName("");
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-2 text-sm font-medium">New space</h2>
        <form onSubmit={create} className="flex gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Space name, e.g. Household"
            disabled={pending}
            className="flex-1"
          />
          <Button type="submit" disabled={!name.trim() || pending}>
            <Plus data-icon="inline-start" />
            Create
          </Button>
        </form>
      </section>

      {spaces.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No spaces yet. Create one, then move lists into it from a list&rsquo;s ⋯ menu.
        </p>
      ) : (
        spaces.map((s) => <SpaceCard key={s.id} space={s} viewerId={viewerId} />)
      )}
    </div>
  );
}

function SpaceCard({ space, viewerId }: { space: SpaceView; viewerId: string }) {
  const router = useRouter();
  const isAdmin = space.role === "admin";
  const [members, setMembers] = useState<SpaceMemberView[]>([]);
  const [suggestions, setSuggestions] = useState<CollaboratorView[]>([]);
  const [person, setPerson] = useState("");
  const [saving, start] = useTransition();
  const tap = useTapToConfirm();

  const load = useCallback(
    () =>
      Promise.all([
        listSpaceMembersAction(space.id),
        isAdmin ? listSuggestedSpaceMembersAction(space.id) : Promise.resolve([]),
      ]).then(([rows, suggested]) => {
        setMembers(rows);
        setSuggestions(suggested);
      }),
    [space.id, isAdmin],
  );

  useEffect(() => {
    void runAction(load(), `load the people in ${space.name}`);
  }, [load, space.name]);

  // A change to the Space holds the card until it lands, then reloads its
  // people and the page (the board and this list of Spaces).
  function save(action: () => Promise<unknown>, what: string, after?: () => void) {
    start(async () => {
      if (!(await runAction(action(), what))) return;
      after?.();
      await runAction(load(), `load the people in ${space.name}`);
      router.refresh();
    });
  }

  const admins = members.filter((m) => m.status === "accepted" && m.role === "admin");
  const lastAdmin = isAdmin && admins.length === 1;

  return (
    <section
      aria-busy={saving}
      className={`space-y-3 rounded-lg border p-3 transition-opacity ${saving ? "pointer-events-none opacity-60" : ""}`}
    >
      <header className="flex items-center gap-2">
        <Boxes className="size-4 shrink-0 text-muted-foreground" />
        {isAdmin ? (
          <EditableText
            value={space.name}
            required
            onSave={async (next) => {
              if (await runAction(updateSpaceAction(space.id, { name: next }), "rename the space")) {
                router.refresh();
              }
            }}
            className="min-w-0 truncate rounded-md px-1 text-sm font-semibold hover:bg-muted"
            inputClassName="h-7 px-1 text-sm font-semibold"
          />
        ) : (
          <h2 className="min-w-0 truncate text-sm font-semibold">{space.name}</h2>
        )}
        {isAdmin && (
          <span className={`${BADGE} bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-400`}>
            Admin
          </span>
        )}
      </header>

      {isAdmin && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const handle = person.trim();
            if (handle) {
              save(() => inviteSpaceMemberAction(space.id, handle), `invite ${handle}`, () =>
                setPerson(""),
              );
            }
          }}
          className="flex gap-2"
        >
          <Input
            value={person}
            onChange={(e) => setPerson(e.target.value)}
            placeholder="Invite by username or email"
            autoComplete="off"
            aria-label={`Invite someone to ${space.name}`}
          />
          <Button type="submit" size="sm" disabled={!person.trim()}>
            Invite
          </Button>
        </form>
      )}

      <ul className="space-y-1">
        {members.map((m) => {
          const self = m.userId === viewerId;
          const key = `remove:${m.userId}`;
          const removeLabel = self ? "Leave" : m.status === "pending" ? "Revoke" : "Remove";
          const canRemove = self ? !lastAdmin : isAdmin;
          return (
            <li
              key={m.userId}
              className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <div className="min-w-0">
                <span className="block truncate text-sm">
                  {displayName(m)}
                  {self && <span className="text-muted-foreground"> (you)</span>}
                </span>
                {m.email && (
                  <span className="block truncate text-xs text-neutral-500">{m.email}</span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {m.status === "pending" ? (
                  <span className={`${BADGE} bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400`}>
                    Pending
                  </span>
                ) : (
                  m.role === "admin" && (
                    <span className={`${BADGE} bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-400`}>
                      Admin
                    </span>
                  )
                )}
                {isAdmin && m.status === "accepted" && !(m.role === "admin" && admins.length === 1) && (
                  <button
                    type="button"
                    onClick={() =>
                      save(
                        () =>
                          setSpaceMemberRoleAction(
                            space.id,
                            m.userId,
                            m.role === "admin" ? "member" : "admin",
                          ),
                        `change ${displayName(m)}'s role`,
                      )
                    }
                    className="rounded px-1.5 py-0.5 text-xs text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
                  >
                    {m.role === "admin" ? "Make member" : "Make admin"}
                  </button>
                )}
                {canRemove && (
                  <button
                    type="button"
                    onClick={() =>
                      tap.confirm(
                        () =>
                          save(
                            () => removeSpaceMemberAction(space.id, m.userId),
                            self ? `leave ${space.name}` : `remove ${displayName(m)}`,
                          ),
                        key,
                      )
                    }
                    aria-label={
                      tap.isArmed(key)
                        ? `Confirm: ${removeLabel.toLowerCase()} ${self ? space.name : displayName(m)}`
                        : `${removeLabel} ${self ? space.name : displayName(m)}`
                    }
                    className={`rounded px-1.5 py-0.5 text-xs ${
                      tap.isArmed(key)
                        ? "bg-destructive font-medium text-white"
                        : "text-neutral-500 hover:bg-neutral-200 hover:text-red-600 dark:hover:bg-neutral-700"
                    }`}
                  >
                    {tap.isArmed(key) ? "Confirm?" : removeLabel}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {lastAdmin && members.length > 1 && (
        <p className="px-2 text-xs text-muted-foreground">
          You&rsquo;re the only admin. Make someone else an admin before you leave.
        </p>
      )}

      {isAdmin && suggestions.length > 0 && (
        <div>
          <h3 className="px-2 pb-1 text-xs font-medium text-neutral-500">
            People you share lists with
          </h3>
          <ul className="space-y-1">
            {suggestions.map((s) => (
              <li
                key={s.userId}
                className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                <div className="min-w-0">
                  <span className="block truncate text-sm">{displayName(s)}</span>
                  {s.email && (
                    <span className="block truncate text-xs text-neutral-500">{s.email}</span>
                  )}
                </div>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() =>
                    save(() => inviteSpaceMemberAction(space.id, `@${s.username}`), `invite ${displayName(s)}`)
                  }
                  aria-label={`Invite ${displayName(s)} to ${space.name}`}
                >
                  Invite
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {isAdmin && (
        <div className="flex justify-end border-t pt-3">
          <Button
            type="button"
            size="sm"
            variant="destructive"
            onClick={() =>
              tap.confirm(
                () => save(() => deleteSpaceAction(space.id), `delete ${space.name}`),
                "delete",
              )
            }
            className={tap.isArmed("delete") ? "bg-destructive text-white hover:bg-destructive" : undefined}
          >
            {tap.isArmed("delete") ? "Confirm delete?" : "Delete space"}
          </Button>
        </div>
      )}
    </section>
  );
}
