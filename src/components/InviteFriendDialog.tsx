"use client";

import { useRef, useState, useTransition } from "react";
import { Mail } from "lucide-react";
import { unstable_rethrow } from "next/navigation";
import { toast } from "sonner";
import { inviteByEmailAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ResponsiveDialog,
  ResponsiveDialogCloseButton,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import type { InvitationView } from "@/core/invitations";
import { InvitedRow } from "./CheckInsView";
import { useDraft } from "./use-draft";

/**
 * Invite a friend to Sidetrack by email, sharing nothing: they get a link
 * that signs them up, even where sign-up is closed. It holds while it sends,
 * since the server can refuse (already on Sidetrack, the day's limit).
 */
export function InviteFriendDialog({
  open,
  onOpenChange,
  invited,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Invites sent from here nobody has accepted yet, to send again or cancel. */
  invited: InvitationView[];
}) {
  const draft = useDraft("invite-friend:email");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const emailRef = useRef<HTMLInputElement>(null);
  const email = draft.value.trim();

  function close(next: boolean) {
    if (pending) return;
    if (!next) {
      draft.clear();
      setError(null);
    }
    onOpenChange(next);
  }

  function send() {
    if (pending || !email) return;
    setError(null);
    start(async () => {
      let refused: string | undefined;
      try {
        refused = (await inviteByEmailAction(email, []))?.error;
      } catch (err) {
        unstable_rethrow(err);
        refused = "Couldn't send the invite. Please try again.";
      }
      if (refused) return setError(refused);
      toast.success(`Invite sent to ${email}`);
      draft.clear();
      onOpenChange(false);
    });
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={close}>
      <ResponsiveDialogContent initialFocus={emailRef}>
        <div className="flex shrink-0 flex-col gap-0.5 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <div className="flex items-center gap-2">
            <ResponsiveDialogTitle className="flex items-center gap-2">
              <Mail className="size-4 shrink-0 text-neutral-500" aria-hidden />
              Invite a friend
            </ResponsiveDialogTitle>
            <ResponsiveDialogCloseButton className="ml-auto shrink-0" />
          </div>
          <ResponsiveDialogDescription className="text-xs text-neutral-500">
            We’ll email them a link to join Sidetrack. Nothing of yours is shared.
          </ResponsiveDialogDescription>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          data-pending={pending || undefined}
          className="flex flex-col data-pending:opacity-60"
        >
          <div className="px-4 py-3">
            <Input
              ref={emailRef}
              type="email"
              value={draft.value}
              onChange={(e) => {
                if (pending) return;
                draft.set(e.target.value);
                setError(null);
              }}
              readOnly={pending}
              placeholder="Their email"
              aria-label="Their email"
              autoComplete="off"
            />
          </div>
          {invited.length > 0 && (
            <section aria-label="Invited, not joined yet" className="space-y-1 border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
              <h3 className="pb-1 text-xs text-neutral-500">Invited, not joined yet</h3>
              {invited.map((i) => (
                <InvitedRow key={i.id} invitation={i} />
              ))}
            </section>
          )}
          <div className="flex items-center gap-3 border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
            <p
              role={error ? "alert" : undefined}
              className={`min-w-0 flex-1 text-xs ${error ? "text-red-600 dark:text-red-400" : "text-neutral-500"}`}
            >
              {error ?? "The link works for 30 days."}
            </p>
            <Button type="submit" size="sm" aria-disabled={!email || pending || undefined}>
              <Mail data-icon="inline-start" />
              {pending ? "Sending…" : "Send invite"}
            </Button>
          </div>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
