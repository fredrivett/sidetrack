"use client";

import { useTransition } from "react";
import {
  acceptInviteAction,
  acceptSpaceInviteAction,
  declineInviteAction,
  declineSpaceInviteAction,
} from "@/app/actions";
import type { PendingInviteView } from "@/core/members";
import type { PendingSpaceInviteView } from "@/core/spaces";
import { Button } from "@/components/ui/button";
import { runAction } from "./run-action";

/**
 * A strip of pending invites shown above the board, to lists and to Spaces.
 * Each can be accepted (the list, or the Space's lists, join your board) or
 * declined (the invite is dropped). Renders nothing when there are none.
 */
export function InvitesBanner({
  invites,
  spaceInvites,
}: {
  invites: PendingInviteView[];
  spaceInvites: PendingSpaceInviteView[];
}) {
  // While one answer saves, the buttons dim and ignore presses but keep
  // focus (aria-disabled, not disabled), as the board's other holds do.
  const [pending, start] = useTransition();
  if (invites.length === 0 && spaceInvites.length === 0) return null;

  return (
    <div className="shrink-0 space-y-2 border-b border-amber-200 bg-amber-50 px-4 py-2 dark:border-amber-900 dark:bg-amber-950/40">
      {spaceInvites.map((invite) => (
        <div key={invite.spaceId} className="flex items-center justify-between gap-3 text-sm">
          <span className="min-w-0 truncate text-amber-900 dark:text-amber-200">
            You&rsquo;re invited to join the space{" "}
            <span className="font-medium">“{invite.spaceName}”</span> and share its lists
          </span>
          <div className="flex shrink-0 gap-2">
            <Button
              size="sm"
              aria-disabled={pending || undefined}
              className="aria-disabled:opacity-50"
              onClick={() =>
                !pending &&
                start(async () => {
                  await runAction(
                    acceptSpaceInviteAction(invite.spaceId),
                    `join “${invite.spaceName}”`,
                  );
                })
              }
            >
              Join
            </Button>
            <Button
              size="sm"
              variant="outline"
              aria-disabled={pending || undefined}
              className="aria-disabled:opacity-50"
              onClick={() =>
                !pending &&
                start(async () => {
                  await runAction(
                    declineSpaceInviteAction(invite.spaceId),
                    `decline the invite to “${invite.spaceName}”`,
                  );
                })
              }
            >
              Decline
            </Button>
          </div>
        </div>
      ))}
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
              aria-disabled={pending || undefined}
              className="aria-disabled:opacity-50"
              onClick={() =>
                !pending &&
                start(async () => {
                  await runAction(
                    acceptInviteAction(invite.projectId),
                    `accept the invite to “${invite.projectName}”`,
                  );
                })
              }
            >
              Accept
            </Button>
            <Button
              size="sm"
              variant="outline"
              aria-disabled={pending || undefined}
              className="aria-disabled:opacity-50"
              onClick={() =>
                !pending &&
                start(async () => {
                  await runAction(
                    declineInviteAction(invite.projectId),
                    `decline the invite to “${invite.projectName}”`,
                  );
                })
              }
            >
              Decline
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
