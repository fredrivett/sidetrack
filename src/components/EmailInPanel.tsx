"use client";

import { Mail } from "lucide-react";
import { unstable_rethrow, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createEmailAddressAction, removeEmailAddressAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { formatRelative } from "@/lib/time";
import { useTapToConfirm } from "./use-tap-to-confirm";

/** The armed look for a destructive button, filled red. */
const ARMED =
  "bg-destructive! text-white! hover:bg-destructive/90! dark:bg-destructive! dark:hover:bg-destructive/90!";

export function EmailInPanel({
  address,
}: {
  address: { email: string; createdAt: number; lastReceivedAt: number | null } | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const tap = useTapToConfirm();
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await action();
        router.refresh();
      } catch (e) {
        // A signed-out session rejects with Next's redirect to /login.
        unstable_rethrow(e);
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    });
  }

  if (!address) {
    return (
      <section className="space-y-3">
        <Button disabled={pending} onClick={() => run(createEmailAddressAction)}>
          <Mail data-icon="inline-start" />
          {pending ? "…" : "Get an address"}
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Your address</h2>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded border bg-background px-2 py-1.5 font-mono text-xs select-all">
            {address.email}
          </code>
          <CopyButton value={address.email} aria-label="Copy address" />
        </div>
        <p className="text-xs text-muted-foreground">
          Created {formatRelative(address.createdAt)} · last email{" "}
          {address.lastReceivedAt === null ? "never" : formatRelative(address.lastReceivedAt)}
        </p>
        <p className="text-sm text-muted-foreground">
          Anyone with this address can send to it, so keep it to yourself. If it
          gets out, replace it: the old one stops working.
        </p>
      </section>

      <section className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => tap.confirm(() => run(createEmailAddressAction), "replace")}
        >
          {tap.isArmed("replace") ? "Confirm replace?" : "Replace address"}
        </Button>
        <Button
          variant="destructive"
          size="sm"
          disabled={pending}
          onClick={() => tap.confirm(() => run(removeEmailAddressAction), "remove")}
          className={tap.isArmed("remove") ? ARMED : undefined}
        >
          {tap.isArmed("remove") ? "Confirm turn off?" : "Turn off"}
        </Button>
      </section>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
