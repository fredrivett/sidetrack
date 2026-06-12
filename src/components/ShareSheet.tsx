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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useMediaQuery } from "@/components/ui/use-media-query";

function displayName(m: MemberView) {
  return m.displayUsername ? `@${m.displayUsername}` : (m.name ?? m.email ?? m.userId);
}

/**
 * Owner-only panel to manage a project's collaborators: invite by username or
 * email, see who's a member (and who has a pending invite), and remove them.
 * Members are lazy-loaded when the sheet opens.
 */
export function ShareSheet({
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
  const isDesktop = useMediaQuery("(min-width: 768px)", true);
  const [members, setMembers] = useState<MemberView[]>([]);
  const [person, setPerson] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Always holds the currently-open project (synced in the load effect below).
  // An invite/remove fetches the roster for the project it was issued against;
  // if the sheet has since moved to another project, that late response must
  // not overwrite the new roster.
  const latestProjectId = useRef(projectId);

  // Clear the form when the sheet opens (or switches project) — the render-time
  // reset pattern, so we don't setState synchronously inside the load effect.
  const [opened, setOpened] = useState({ open, projectId });
  if (opened.open !== open || opened.projectId !== projectId) {
    setOpened({ open, projectId });
    setPerson("");
    setError(null);
  }

  // Load the roster whenever the sheet opens for a project.
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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isDesktop ? "right" : "bottom"}
        className={
          isDesktop
            ? "w-full gap-0 p-0 data-[side=right]:sm:max-w-md"
            : "gap-0 rounded-t-xl p-0"
        }
      >
        <SheetHeader className="border-b border-neutral-200 px-4 py-3 pr-14 dark:border-neutral-800">
          <SheetTitle className="text-base">Share “{projectName}”</SheetTitle>
          <SheetDescription className="text-xs text-neutral-500">
            Invite people by username or email. They’ll need a Sidetrack account
            and must accept before they can edit.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={invite} className="border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
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

        <div className="flex-1 overflow-y-auto px-4 py-3">
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
                      onClick={() => remove(m.userId)}
                      disabled={pending}
                      className="rounded px-1.5 py-0.5 text-xs text-neutral-500 hover:bg-neutral-200 hover:text-red-600 disabled:opacity-50 dark:hover:bg-neutral-700"
                      aria-label={`Remove ${displayName(m)}`}
                    >
                      {m.status === "pending" ? "Revoke" : "Remove"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
