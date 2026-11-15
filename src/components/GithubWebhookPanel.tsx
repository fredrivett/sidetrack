"use client";

import { Check, Copy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { removeGithubWebhookAction, setUpGithubWebhookAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import type { GithubWebhookView } from "@/core/github";
import { useTapToConfirm } from "./use-tap-to-confirm";

/** A labelled value to paste into GitHub's form, with a copy button. */
function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded border bg-background px-2 py-1.5 font-mono text-xs select-all">
          {value}
        </code>
        <Button
          variant="outline"
          size="sm"
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
    </div>
  );
}

function fmt(ts: number | null): string {
  return ts === null ? "never" : new Date(ts).toLocaleString();
}

export function GithubWebhookPanel({
  webhook,
  payloadUrl,
}: {
  webhook: GithubWebhookView | null;
  payloadUrl: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const tap = useTapToConfirm();
  // Shown once, right after setting up or rotating, like a new API key.
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await action();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    });
  }
  const setUp = () =>
    run(async () => setSecret((await setUpGithubWebhookAction()).secret));
  const remove = () =>
    run(async () => {
      await removeGithubWebhookAction();
      setSecret(null);
    });

  if (!webhook || !payloadUrl) {
    return (
      <section className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Set up a webhook to get a payload URL and secret, then add them to a
          repository under Settings → Webhooks on GitHub.
        </p>
        <Button onClick={setUp} disabled={pending}>
          {pending ? "…" : "Set up webhook"}
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Add it to a repository</h2>
        <p className="text-sm text-muted-foreground">
          On GitHub, open the repository&apos;s Settings → Webhooks → Add webhook,
          and fill it in as below. Under &ldquo;Which events&rdquo;, pick &ldquo;Let me
          select individual events&rdquo; and tick only Pull requests. One webhook
          works for any number of repositories.
        </p>
        <CopyField label="Payload URL" value={payloadUrl} />
        <CopyField label="Content type" value="application/json" />
        {secret ? (
          <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950/40">
            <CopyField label="Secret" value={secret} />
            <p className="text-xs text-muted-foreground">
              Copy it now; it won&apos;t be shown again.
            </p>
            <Button variant="ghost" size="sm" onClick={() => setSecret(null)}>
              I&apos;ve copied it
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Secret: the one shown when you set it up. Lost it? Make a new one and
            paste that into GitHub instead.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Last delivery: {fmt(webhook.lastDeliveryAt)}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => tap.confirm(setUp, "secret")}
          >
            {tap.isArmed("secret") ? "Confirm new secret?" : "New secret"}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={pending}
            onClick={() => tap.confirm(remove, "remove")}
            className={
              tap.isArmed("remove")
                ? "bg-destructive! text-white! hover:bg-destructive/90! dark:bg-destructive! dark:hover:bg-destructive/90!"
                : undefined
            }
          >
            {tap.isArmed("remove") ? "Confirm remove?" : "Remove webhook"}
          </Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </section>
    </div>
  );
}
