"use client";

import { ArrowUpRight, Plus, Webhook } from "lucide-react";
import { unstable_rethrow, useRouter } from "next/navigation";
import { useState, useSyncExternalStore, useTransition } from "react";
import {
  addGithubWebhookSecretAction,
  removeGithubWebhookAction,
  removeGithubWebhookSecretAction,
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/input";
import type { GithubWebhookView } from "@/core/github";
import { formatRelative } from "@/lib/time";
import { GitHubMark } from "./GitHubMark";
import { useTapToConfirm } from "./use-tap-to-confirm";

/** A labelled value to paste into GitHub's form, with a copy button. */
function CopyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded border bg-background px-2 py-1.5 font-mono text-xs select-all">
          {value}
        </code>
        <CopyButton value={value} aria-label={`Copy ${label.toLowerCase()}`} />
      </div>
    </div>
  );
}

/** The armed look for a destructive button, filled red. */
const ARMED =
  "bg-destructive! text-white! hover:bg-destructive/90! dark:bg-destructive! dark:hover:bg-destructive/90!";

const noSubscribe = () => () => {};

/**
 * A time as "3d ago", with the full local date on hover. Relative text renders
 * the same on the server as in the browser; the full date depends on the
 * viewer's timezone, so the title is only added once in the browser.
 */
function Time({ ts }: { ts: number | null }) {
  const inBrowser = useSyncExternalStore(noSubscribe, () => true, () => false);
  if (ts === null) return "never";
  const date = new Date(ts);
  return (
    <time dateTime={date.toISOString()} title={inBrowser ? date.toLocaleString() : undefined}>
      {formatRelative(ts)}
    </time>
  );
}

export function GithubWebhookPanel({
  webhook,
  payloadUrl,
  repos,
}: {
  webhook: GithubWebhookView | null;
  payloadUrl: string | null;
  /** `owner/repo`s the board already has PRs from, to link straight to. */
  repos: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const tap = useTapToConfirm();
  const [name, setName] = useState("");
  // Shown once, right after adding it, like a new API key.
  const [created, setCreated] = useState<{ id: string; name: string; secret: string } | null>(
    null,
  );
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
  function add(formData: FormData) {
    const raw = String(formData.get("name") ?? "").trim();
    if (!raw) return;
    run(async () => {
      const { id, secret } = await addGithubWebhookSecretAction(raw);
      setCreated({ id, name: raw, secret });
      setName("");
    });
  }
  const removeSecret = (id: string) =>
    run(async () => {
      await removeGithubWebhookSecretAction(id);
      // Stop showing a secret that no longer works.
      setCreated((c) => (c?.id === id ? null : c));
    });
  const remove = () =>
    run(async () => {
      await removeGithubWebhookAction();
      setCreated(null);
    });

  const addForm = (
    <form action={add} className="flex gap-2">
      <Input
        name="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={`Secret name, e.g. ${repos[0] ?? "owner/repo"}`}
        aria-label="Secret name"
        className="flex-1"
        autoComplete="off"
      />
      <Button type="submit" disabled={pending || !name.trim()}>
        {webhook ? <Plus data-icon="inline-start" /> : <Webhook data-icon="inline-start" />}
        {pending ? "…" : webhook ? "Add secret" : "Set up webhook"}
      </Button>
    </form>
  );

  if (!webhook || !payloadUrl) {
    return (
      <section className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Name a first secret, say for the repository it&apos;s for, to get a
          payload URL and secret. Then add them to a repository under Settings →
          Webhooks on GitHub.
        </p>
        {addForm}
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
          select individual events&rdquo;, tick Pull requests, and untick Pushes,
          which GitHub leaves ticked. One webhook works for any number of
          repositories.
        </p>
        {repos.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
              Add webhook for a repository you&apos;ve linked PRs from
            </p>
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {repos.map((repo) => (
                <li key={repo}>
                  <a
                    href={`https://github.com/${repo}/settings/hooks/new`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 text-sm text-neutral-500 transition hover:text-neutral-900 hover:underline dark:text-neutral-400 dark:hover:text-neutral-100"
                  >
                    <GitHubMark className="size-3.5 shrink-0" />
                    {repo}
                    <ArrowUpRight className="size-3.5 shrink-0" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
        <CopyField label="Payload URL" value={payloadUrl} />
        <CopyField label="Content type" value="application/json" />
        {created ? (
          <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950/40">
            <CopyField label={`Secret: ${created.name}`} value={created.secret} />
            <p className="text-xs text-muted-foreground">
              Copy it now; it won&apos;t be shown again.
            </p>
            <Button variant="ghost" size="sm" onClick={() => setCreated(null)}>
              I&apos;ve copied it
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Secret: one of the secrets below, shown when you added it. Lost it?
            Add a new one and paste that into GitHub instead.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Secrets</h2>
        <p className="text-sm text-muted-foreground">
          GitHub&apos;s deliveries are accepted when signed with any of these. Give
          each repository its own, or rotate one by adding a new secret, pasting
          it into GitHub, then removing the old one.
        </p>
        {webhook.secrets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No secrets: deliveries are refused until you add one.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border">
            {webhook.secrets.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{s.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Created <Time ts={s.createdAt} /> · last delivery <Time ts={s.lastDeliveryAt} />
                  </p>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={pending}
                  onClick={() => tap.confirm(() => removeSecret(s.id), s.id)}
                  className={tap.isArmed(s.id) ? ARMED : undefined}
                >
                  {tap.isArmed(s.id) ? "Confirm?" : "Remove"}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {addForm}
      </section>

      <section className="space-y-3">
        <Button
          variant="destructive"
          size="sm"
          disabled={pending}
          onClick={() => tap.confirm(remove, "remove")}
          className={tap.isArmed("remove") ? ARMED : undefined}
        >
          {tap.isArmed("remove") ? "Confirm remove?" : "Remove webhook"}
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </section>
    </div>
  );
}
