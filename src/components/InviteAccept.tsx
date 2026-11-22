"use client";

import { useState, useTransition } from "react";
import { HeartHandshake } from "lucide-react";
import { unstable_rethrow } from "next/navigation";
import { acceptInvitationAction } from "@/app/actions";
import { Button } from "@/components/ui/button";

/**
 * Accept an invite to join, signed in already: someone with an account who
 * opened the link. It holds while it saves (the server decides what's
 * shared), then goes where it shows.
 */
export function InviteAccept({ token, label }: { token: string; label: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <Button
        size="lg"
        className="w-full"
        aria-disabled={pending || undefined}
        onClick={() =>
          !pending &&
          start(async () => {
            setError(null);
            let refused: string | undefined;
            try {
              refused = (await acceptInvitationAction(token))?.error;
            } catch (err) {
              // A success redirects, which arrives as a thrown redirect.
              unstable_rethrow(err);
              refused = "Couldn't accept the invite. Please try again.";
            }
            if (refused) setError(refused);
          })
        }
      >
        <HeartHandshake data-icon="inline-start" />
        {pending ? "Accepting…" : label}
      </Button>
      {error && (
        <p role="alert" className="text-center text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
