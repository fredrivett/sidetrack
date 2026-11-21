"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { UserPlus } from "lucide-react";
import { unstable_rethrow } from "next/navigation";
import {
  inviteMemberAction,
  listMembersAction,
  listSuggestedCollaboratorsAction,
  removeMemberAction,
  setMemberRoleAction,
} from "@/app/actions";
import type { CollaboratorView, MemberView } from "@/core/members";
import { LIST_ROLES, type ListRole } from "@/core/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ResponsiveDialog,
  ResponsiveDialogCloseButton,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { RoleSelect } from "./RoleSelect";
import { runAction } from "./run-action";
import { useDraft } from "./use-draft";
import { useStoredState } from "./use-stored-state";
import { useTapToConfirm } from "./use-tap-to-confirm";

function displayName(m: CollaboratorView) {
  return m.displayUsername ? `@${m.displayUsername}` : (m.name ?? m.email ?? m.userId);
}

/**
 * Owner-only panel to manage a project's collaborators: invite by username or
 * email (or with one tap, someone from the owner's other lists), see who's a
 * member (and who has a pending invite), and remove them. Members and
 * suggestions are lazy-loaded when the dialog opens.
 */
export function ShareDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string | null;
  projectName: string;
}) {
  const [members, setMembers] = useState<MemberView[]>([]);
  const [suggestions, setSuggestions] = useState<CollaboratorView[]>([]);
  // Who's being invited, and as what, outlive a reload: the role is part
  // of the draft, and stays as chosen between invites.
  const draft = useDraft(projectId ? `share:${projectId}:person` : null);
  const person = draft.value;
  const [role, setRole] = useStoredState<ListRole>(
    `draft:share:${projectId ?? ""}:role`,
    "editor",
  );
  const [onlyMine, setOnlyMine] = useStoredState(`draft:share:${projectId ?? ""}:only-mine`, false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Removing someone takes a second tap: it also takes them off their items.
  const tap = useTapToConfirm();

  // Always holds the currently-open project (synced in the load effect below).
  // An invite/remove fetches the roster for the project it was issued against;
  // if the dialog has since moved to another project, that late response must
  // not overwrite the new roster.
  const latestProjectId = useRef(projectId);
  const personRef = useRef<HTMLInputElement>(null);

  // Clear the form when the dialog opens (or switches project) — the render-time
  // reset pattern, so we don't setState synchronously inside the load effect.
  const [opened, setOpened] = useState({ open, projectId });
  if (opened.open !== open || opened.projectId !== projectId) {
    setOpened({ open, projectId });
    setError(null);
    // Suggestions are for one project: an Invite left over from the last one
    // would invite that person here, so hide them until this project's load.
    setSuggestions([]);
    // A tap armed before closing must not carry over to the next open.
    tap.reset();
  }

  // Load the roster whenever the dialog opens for a project.
  useEffect(() => {
    latestProjectId.current = projectId;
    if (!open || !projectId) return;
    let active = true;
    void runAction(
      Promise.all([
        listMembersAction(projectId),
        listSuggestedCollaboratorsAction(projectId),
      ]).then(
        ([rows, suggested]) => {
          if (!active) return;
          setMembers(rows);
          setSuggestions(suggested);
        },
        // Once the dialog has closed or moved on, a failed load is moot, but a
        // signed-out session's redirect to /login still goes through.
        (error) => {
          unstable_rethrow(error);
          if (active) throw error;
        },
      ),
      "load who's on this list",
    );
    return () => {
      active = false;
    };
  }, [open, projectId]);

  // Re-read members and suggestions after an invite or removal, so a person
  // moves between the two lists. The change has already committed, so a failed
  // re-read isn't reported as a failed invite/removal; the board's own refresh
  // and the next open bring the lists up to date.
  async function reload(id: string) {
    try {
      const [rows, suggested] = await Promise.all([
        listMembersAction(id),
        listSuggestedCollaboratorsAction(id),
      ]);
      if (latestProjectId.current !== id) return;
      setMembers(rows);
      setSuggestions(suggested);
    } catch (err) {
      // A signed-out session rejects with Next's redirect to /login.
      unstable_rethrow(err);
      // Leave the lists as they were.
    }
  }

  // Invite by handle, from the form or a suggestion; `fromForm` clears the
  // input on success.
  function invite(handle: string, fromForm: boolean) {
    if (!handle || !projectId) return;
    setError(null);
    start(async () => {
      try {
        await inviteMemberAction(projectId, handle, role, role !== "editor" && onlyMine);
      } catch (err) {
        unstable_rethrow(err);
        if (latestProjectId.current !== projectId) return;
        setError(err instanceof Error ? err.message : "Couldn't send the invite.");
        return;
      }
      if (fromForm && latestProjectId.current === projectId) draft.clear();
      await reload(projectId);
    });
  }

  function changeRole(targetUserId: string, next: ListRole, onlyMine?: boolean) {
    if (!projectId) return;
    setError(null);
    start(async () => {
      try {
        await setMemberRoleAction(projectId, targetUserId, next, onlyMine);
      } catch (err) {
        unstable_rethrow(err);
        if (latestProjectId.current !== projectId) return;
        setError("Couldn't change what they can do. Please try again.");
        return;
      }
      await reload(projectId);
    });
  }

  function remove(targetUserId: string) {
    if (!projectId) return;
    start(async () => {
      try {
        await removeMemberAction(projectId, targetUserId);
      } catch (err) {
        unstable_rethrow(err);
        if (latestProjectId.current !== projectId) return;
        setError("Couldn't remove that person. Please try again.");
        return;
      }
      await reload(projectId);
    });
  }

  return (
    // Closing drops what's typed, as cancelling does.
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          draft.clear();
          setRole("editor");
          setOnlyMine(false);
        }
        onOpenChange(next);
      }}
    >
      <ResponsiveDialogContent initialFocus={personRef}>
        <div className="flex shrink-0 flex-col gap-0.5 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <div className="flex items-center gap-2">
            <ResponsiveDialogTitle className="min-w-0 break-words">
              Share “{projectName}”
            </ResponsiveDialogTitle>
            <ResponsiveDialogCloseButton className="ml-auto shrink-0" />
          </div>
          <ResponsiveDialogDescription className="text-xs text-neutral-500">
            Invite people by username or email. They’ll need a Sidetrack account
            and must accept before they can see it.
          </ResponsiveDialogDescription>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            invite(person.trim(), true);
          }}
          className="shrink-0 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <div className="flex gap-2">
            <Input
              ref={personRef}
              value={person}
              onChange={(e) => draft.set(e.target.value)}
              placeholder="username or email"
              autoComplete="off"
              disabled={pending}
            />
            <RoleSelect
              label="What they can do"
              value={role}
              roles={LIST_ROLES}
              scope="list"
              disabled={pending}
              onChange={setRole}
              onlyMine={{ value: onlyMine, onChange: setOnlyMine }}
            />
            <Button type="submit" size="sm" disabled={!person.trim() || pending}>
              <UserPlus data-icon="inline-start" />
              Invite
            </Button>
          </div>
          {error && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
          )}
        </form>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
          {members.length === 0 && suggestions.length === 0 && (
            <p className="py-6 text-center text-xs text-neutral-500">
              No collaborators yet.
            </p>
          )}
          {members.length > 0 && (
            <ul className="space-y-1">
              {members.map((m) => (
                <li
                  key={m.userId}
                  className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  <div className="min-w-0">
                    <span className="block truncate text-sm">{displayName(m)}</span>
                    {m.email && (
                      <span className="block truncate text-xs text-neutral-500">
                        {m.email}
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {m.status === "pending" && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:bg-amber-950 dark:text-amber-400">
                        Pending
                      </span>
                    )}
                    <RoleSelect
                      label={`What ${displayName(m)} can do`}
                      value={m.role}
                      roles={LIST_ROLES}
              scope="list"
                      disabled={pending}
                      onChange={(next) => changeRole(m.userId, next)}
                      onlyMine={{
                        value: m.onlyAssignedTo !== null,
                        onChange: (on) => changeRole(m.userId, m.role, on),
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => tap.confirm(() => remove(m.userId), m.userId)}
                      disabled={pending}
                      className={`rounded px-1.5 py-0.5 text-xs disabled:opacity-50 ${
                        tap.isArmed(m.userId)
                          ? "bg-destructive font-medium text-white"
                          : "text-neutral-500 hover:bg-neutral-200 hover:text-red-600 dark:hover:bg-neutral-700"
                      }`}
                      aria-label={
                        tap.isArmed(m.userId)
                          ? `Confirm ${m.status === "pending" ? "revoking" : "removing"} ${displayName(m)}`
                          : `${m.status === "pending" ? "Revoke" : "Remove"} ${displayName(m)}`
                      }
                    >
                      {tap.isArmed(m.userId)
                        ? "Confirm?"
                        : m.status === "pending"
                          ? "Revoke"
                          : "Remove"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {suggestions.length > 0 && (
            <section className={members.length > 0 ? "mt-4" : undefined}>
              <h3 className="px-2 pb-1 text-xs font-medium text-neutral-500">
                From your other lists
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
                        <span className="block truncate text-xs text-neutral-500">
                          {s.email}
                        </span>
                      )}
                    </div>
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      onClick={() => invite(`@${s.username}`, false)}
                      disabled={pending}
                      aria-label={`Invite ${displayName(s)}`}
                    >
                      Invite
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
