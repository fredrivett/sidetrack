"use client";

import { Boxes, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
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
import { SPACE_ROLES, type SpaceColor, type SpaceRole } from "@/core/schema";
import { roleName } from "@/lib/roles";
import type { SpaceMemberView, SpaceView } from "@/core/spaces";
import { EditableText } from "./EditableText";
import { ProjectIcon } from "./ProjectIcon";
import { RoleSelect } from "./RoleSelect";
import { IconPicker } from "./ProjectIconPicker";
import { SpaceColorPicker, spaceTint } from "./SpaceColor";
import { runAction } from "./run-action";
import { useTapToConfirm } from "./use-tap-to-confirm";

// The roles someone can be invited with: admins are made from members.
const INVITE_ROLES = SPACE_ROLES.filter(
  (r): r is Exclude<SpaceRole, "admin"> => r !== "admin",
);

function displayName(m: CollaboratorView) {
  return m.displayUsername ? `@${m.displayUsername}` : (m.name ?? m.email ?? m.userId);
}

const BADGE =
  "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide";

/** The viewer's Spaces, and a form to start one. */
export function SpacesPanel({ spaces, viewerId }: { spaces: SpaceView[]; viewerId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<string | null>(null);
  const [color, setColor] = useState<SpaceColor | null>(null);
  const [pending, start] = useTransition();

  // The board's Edit space links to a card by #space-<id>. Each card grows as
  // its people load, so the jump waits for them all, once per visit, else the
  // cards above it would push it out of view.
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(new Set());
  const jumped = useRef(false);
  const onLoaded = useCallback(
    (id: string) => setLoaded((prev) => (prev.has(id) ? prev : new Set(prev).add(id))),
    [],
  );
  useEffect(() => {
    if (jumped.current || !spaces.every((s) => loaded.has(s.id))) return;
    jumped.current = true;
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }, [spaces, loaded]);

  function create(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    start(async () => {
      if (await runAction(createSpaceAction({ name: trimmed, icon, color }), "create the space")) {
        setName("");
        setIcon(null);
        setColor(null);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-2 text-sm font-medium">New space</h2>
        <form onSubmit={create} className="space-y-3">
          <div className="flex gap-2">
            <IconPicker
              icon={icon}
              chosen
              name={name}
              size={20}
              label="new space icon"
              disabled={pending}
              // The input's height and corners, so the two read as one row.
              className="size-8 rounded-lg border border-input"
              suggestions={[]}
              onSelect={setIcon}
            />
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
          </div>
          <SpaceColorPicker
            value={color}
            onChange={setColor}
            label="New space colour"
            disabled={pending}
          />
        </form>
      </section>

      {spaces.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No spaces yet. Create one, then move lists into it from a list&rsquo;s ⋯ menu.
        </p>
      ) : (
        spaces.map((s) => (
          <SpaceCard key={s.id} space={s} viewerId={viewerId} onLoaded={onLoaded} />
        ))
      )}
    </div>
  );
}

function SpaceCard({
  space,
  viewerId,
  onLoaded,
}: {
  space: SpaceView;
  viewerId: string;
  /** Called once its people first load, or fail to. */
  onLoaded: (id: string) => void;
}) {
  const router = useRouter();
  const isAdmin = space.role === "admin";
  const [members, setMembers] = useState<SpaceMemberView[]>([]);
  const [suggestions, setSuggestions] = useState<CollaboratorView[]>([]);
  const [person, setPerson] = useState("");
  // What the next invite lets them do. Admins are made from members, not
  // invited as admins.
  const [role, setRole] = useState<Exclude<SpaceRole, "admin">>("member");
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
    void runAction(load(), `load the people in ${space.name}`).then(() => onLoaded(space.id));
  }, [load, space.name, space.id, onLoaded]);

  // A change to the Space holds the card until it lands, then reloads its
  // people and the page (the board and this list of Spaces).
  function save(action: () => Promise<unknown>, what: string, after?: () => void) {
    // The card ignores pointers while it holds; this stops keys too.
    if (saving) return;
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
      // The board's Edit space links here, by #space-<id>.
      id={`space-${space.id}`}
      aria-busy={saving}
      className={`scroll-mt-6 space-y-3 rounded-lg border p-3 transition-opacity ${spaceTint(space.color)} ${saving ? "pointer-events-none opacity-60" : ""}`}
    >
      <header className="flex items-center gap-2">
        {isAdmin ? (
          <IconPicker
            icon={space.icon}
            chosen
            name={space.name}
            size={18}
            label={`${space.name} icon`}
            disabled={saving}
            // -mx-1 here and on the name cancel their hover padding, so the
            // header's gap-2 is the only space between icon, name and badge.
            className="-mx-1"
            suggestions={[]}
            onSelect={(next) =>
              save(() => updateSpaceAction(space.id, { icon: next }), "change the space's icon")
            }
          />
        ) : space.icon ? (
          <ProjectIcon icon={space.icon} homepageUrl={null} name={space.name} size={18} />
        ) : (
          <Boxes className="size-4 shrink-0 text-muted-foreground" />
        )}
        {isAdmin ? (
          <EditableText
            value={space.name}
            required
            onSave={async (next) => {
              if (await runAction(updateSpaceAction(space.id, { name: next }), "rename the space")) {
                router.refresh();
              }
            }}
            className="-mx-1 min-w-0 truncate rounded-md px-1 text-sm font-semibold hover:bg-muted"
            inputClassName="-mx-1 h-7 px-1 text-sm font-semibold"
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
        <SpaceColorPicker
          value={space.color}
          onChange={(next) =>
            save(() => updateSpaceAction(space.id, { color: next }), "change the space's colour")
          }
          label={`${space.name} colour`}
        />
      )}

      {isAdmin && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const handle = person.trim();
            if (handle) {
              save(() => inviteSpaceMemberAction(space.id, handle, role), `invite ${handle}`, () =>
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
          <RoleSelect
            label="What they can do"
            value={role}
            roles={INVITE_ROLES}
            onChange={setRole}
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
                ) : isAdmin && !(m.role === "admin" && admins.length === 1) ? (
                  <RoleSelect
                    label={`What ${displayName(m)} can do`}
                    value={m.role}
                    roles={SPACE_ROLES}
                    onChange={(next) =>
                      save(
                        () => setSpaceMemberRoleAction(space.id, m.userId, next),
                        `change ${displayName(m)}'s role`,
                      )
                    }
                  />
                ) : (
                  m.role !== "member" && (
                    <span className={`${BADGE} ${m.role === "admin" ? "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-400" : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"}`}>
                      {m.role === "admin" ? "Admin" : roleName(m.role)}
                    </span>
                  )
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
