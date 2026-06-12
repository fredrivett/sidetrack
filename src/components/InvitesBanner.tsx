"use client";

import { useTransition } from "react";
import { acceptInviteAction, declineInviteAction } from "@/app/actions";
import type { PendingInviteView } from "@/core/members";
import { Button } from "@/components/ui/button";

/**
 * A strip of pending project invites shown above the board. Each can be
 * accepted (the project joins your board) or declined (the invite is dropped).
 * Renders nothing when there are no invites.
 */
export function InvitesBanner({ invites }: { invites: PendingInviteView[] }) {
  const [pending, start] = useTransition();
  if (invites.length === 0) return null;

  return (
    <div className="shrink-0 space-y-2 border-b border-amber-200 bg-amber-50 px-4 py-2 dark:border-amber-900 dark:bg-amber-950/40">
      {invites.map((invite) => (
        <div
          key={invite.projectId}
          className="flex items-center justify-between gap-3 text-sm"
        >
          <span className="min-w-0 truncate text-amber-900 dark:text-amber-200">
            <span className="font-medium">{invite.ownerName ?? "Someone"}</span>{" "}
            invited you to{" "}
            <span className="font-medium">“{invite.projectName}”</span>
          </span>
          <div className="flex shrink-0 gap-2">
            <Button
              size="sm"
              disabled={pending}
              onClick={() => start(() => acceptInviteAction(invite.projectId))}
            >
              Accept
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => start(() => declineInviteAction(invite.projectId))}
            >
              Decline
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
