"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  inviteMemberAction,
  listMembersAction,
  removeMemberAction,
} from "@/app/actions";
import type { MemberView } from "@/core/members";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ResponsiveDialog,
  ResponsiveDialogCloseButton,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { useTapToConfirm } from "./use-tap-to-confirm";

function displayName(m: MemberView) {
  return m.displayUsername ? `@${m.displayUsername}` : (m.name ?? m.email ?? m.userId);
}

/**
 * Owner-only panel to manage a project's collaborators: invite by username or
 * email, see who's a member (and who has a pending invite), and remove them.
 * Members are lazy-loaded when the dialog opens.
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
  const [person, setPerson] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Removing someone takes a second tap: it also takes them off their items.
  const tap = useTapToConfirm();

  // Always holds the currently-open project (synced in the load effect below).
  // An invite/remove fetches the roster for the project it was issued against;
  // if the dialog has since moved to another project, that late response must
  // not overwrite the new roster.
  const latestProjectId = useRef(projectId);

  // Clear the form when the dialog opens (or switches project) — the render-time
  // reset pattern, so we don't setState synchronously inside the load effect.
  const [opened, setOpened] = useState({ open, projectId });
  if (opened.open !== open || opened.projectId !== projectId) {
    setOpened({ open, projectId });
    setPerson("");
    setError(null);
    // A tap armed before closing must not carry over to the next open.
    tap.reset();
  }

  // Load the roster whenever the dialog opens for a project.
  useEffect(() => {
    latestProjectId.current = projectId;
    if (!open || !projectId) return;
    let active = true;
    listMembersAction(projectId).then((rows) => {
      if (active) setMembers(rows);
    });
    return () => {
      active = false;
    };
  }, [open, projectId]);

  function invite(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = person.trim();
    if (!trimmed || !projectId) return;
    setError(null);
    start(async () => {
      try {
        await inviteMemberAction(projectId, trimmed);
        const rows = await listMembersAction(projectId);
        if (latestProjectId.current !== projectId) return;
        setPerson("");
        setMembers(rows);
      } catch (err) {
        if (latestProjectId.current !== projectId) return;
        setError(err instanceof Error ? err.message : "Couldn't send the invite.");
      }
    });
  }

  function remove(targetUserId: string) {
    if (!projectId) return;
    start(async () => {
      try {
        await removeMemberAction(projectId, targetUserId);
        const rows = await listMembersAction(projectId);
        if (latestProjectId.current !== projectId) return;
        setMembers(rows);
      } catch {
        if (latestProjectId.current !== projectId) return;
        setError("Couldn't remove that person. Please try again.");
      }
    });
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <div className="flex shrink-0 flex-col gap-0.5 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <div className="flex items-center gap-2">
            <ResponsiveDialogTitle className="min-w-0 break-words">
              Share “{projectName}”
            </ResponsiveDialogTitle>
            <ResponsiveDialogCloseButton className="ml-auto shrink-0" />
          </div>
          <ResponsiveDialogDescription className="text-xs text-neutral-500">
            Invite people by username or email. They’ll need a Sidetrack account
            and must accept before they can edit.
          </ResponsiveDialogDescription>
        </div>

        <form onSubmit={invite} className="shrink-0 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <div className="flex gap-2">
            <Input
              value={person}
              onChange={(e) => setPerson(e.target.value)}
              placeholder="username or email"
              autoComplete="off"
              disabled={pending}
            />
            <Button type="submit" size="sm" disabled={!person.trim() || pending}>
              Invite
            </Button>
          </div>
          {error && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
          )}
        </form>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
          {members.length === 0 ? (
            <p className="py-6 text-center text-xs text-neutral-500">
              No collaborators yet.
            </p>
          ) : (
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
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
