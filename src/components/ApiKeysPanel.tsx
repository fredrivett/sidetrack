"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { unstable_rethrow, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/input";
import { ARMED_BUTTON, useTapToConfirm } from "./use-tap-to-confirm";
import {
  createApiKeyAction,
  removeAgentWebhookAction,
  revokeApiKeyAction,
  setAgentWebhookAction,
} from "@/app/actions";
import type { AgentWebhookView } from "@/core/agentWebhooks";
import { formatRelative } from "@/lib/time";

type KeyRow = {
  id: string;
  name: string;
  prefix: string;
  createdAt: Date | number;
  lastUsedAt: Date | number | null;
};

function fmt(d: Date | number | null): string {
  if (d === null) return "never";
  return formatRelative(d instanceof Date ? d.getTime() : d);
}

export function ApiKeysPanel({
  initial,
  webhooks = [],
}: {
  initial: KeyRow[];
  webhooks?: AgentWebhookView[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const tap = useTapToConfirm();
  const [name, setName] = useState("");
  const [justCreated, setJustCreated] = useState<{
    plaintext: string;
    name: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  function onCreate(formData: FormData) {
    const raw = String(formData.get("name") ?? "").trim();
    if (!raw) {
      setError("Name required.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const { plaintext } = await createApiKeyAction(raw);
        setJustCreated({ plaintext, name: raw });
        setName("");
        router.refresh();
      } catch (e) {
        // A signed-out session rejects with Next's redirect to /login.
        unstable_rethrow(e);
        setError(e instanceof Error ? e.message : "Failed to create key.");
      }
    });
  }

  // A second tap revokes: any client using the key stops working.
  function onRevoke(id: string) {
    setRevokeError(null);
    startTransition(async () => {
      try {
        await revokeApiKeyAction(id);
        router.refresh();
      } catch (e) {
        unstable_rethrow(e);
        setRevokeError(
          e instanceof Error ? e.message : "Failed to revoke key.",
        );
      }
    });
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-lg border border-border p-4">
        <h2 className="text-sm font-medium">Create a new key</h2>
        <form
          action={onCreate}
          className="flex gap-2"
        >
          <Input
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. claude.ai connector"
            className="flex-1"
            autoComplete="off"
          />
          <Button type="submit" disabled={pending || !name.trim()}>
            <Plus data-icon="inline-start" />
            {pending ? "…" : "Create"}
          </Button>
        </form>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </section>

      {justCreated && (
        <section className="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40 p-3 space-y-2">
          <p className="text-sm font-medium">
            Copy your key now — it won&apos;t be shown again.
          </p>
          <p className="text-xs text-muted-foreground">
            Key for <span className="font-mono">{justCreated.name}</span>:
          </p>
          <code className="block break-all rounded bg-background border px-2 py-1.5 text-xs font-mono select-all">
            {justCreated.plaintext}
          </code>
          <CopyButton value={justCreated.plaintext}>Copy</CopyButton>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setJustCreated(null)}
          >
            I&apos;ve copied it
          </Button>
        </section>
      )}

      <section className="space-y-3 rounded-lg border border-border p-4">
        <h2 className="text-sm font-medium">Existing keys</h2>
        {revokeError && (
          <p role="alert" className="text-sm text-destructive">{revokeError}</p>
        )}
        {initial.length === 0 ? (
          <p className="text-sm text-muted-foreground">No keys yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border">
            {initial.map((k) => (
              <li
                key={k.id}
                className="flex items-start justify-between gap-3 p-3"
              >
                <div className="min-w-0 flex-1 space-y-2">
                  <div>
                    <p className="text-sm font-medium truncate">{k.name}</p>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-mono">{k.prefix}…</span> · created {fmt(k.createdAt)} · last used{" "}
                      {fmt(k.lastUsedAt)}
                    </p>
                  </div>
                  <AgentWebhookControl
                    keyId={k.id}
                    webhook={webhooks.find((w) => w.keyId === k.id) ?? null}
                  />
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => tap.confirm(() => onRevoke(k.id), k.id)}
                  disabled={pending}
                  className={tap.isArmed(k.id) ? ARMED_BUTTON : undefined}
                >
                  {tap.isArmed(k.id) ? "Confirm?" : "Revoke"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * Whether assigning this key's agent to an item starts it: the URL Sidetrack
 * posts to, which is never shown back once saved, and the signing secret,
 * shown once when it's made. Saving or removing holds the control until the
 * server answers, and reports a failure inline, as the other settings do.
 */
function AgentWebhookControl({
  keyId,
  webhook,
}: {
  keyId: string;
  webhook: AgentWebhookView | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const tap = useTapToConfirm();
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function onSave(formData: FormData) {
    const raw = String(formData.get("url") ?? "").trim();
    if (!raw || pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const { secret } = await setAgentWebhookAction(keyId, raw);
        setSecret(secret);
        setEditing(false);
        setUrl("");
        router.refresh();
      } catch (e) {
        unstable_rethrow(e);
        setError(e instanceof Error ? e.message : "Failed to save the webhook.");
      }
    });
  }

  function onRemove() {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      try {
        await removeAgentWebhookAction(keyId);
        setSecret(null);
        router.refresh();
      } catch (e) {
        unstable_rethrow(e);
        setError(e instanceof Error ? e.message : "Failed to remove the webhook.");
      }
    });
  }

  return (
    <div className="space-y-2">
      {editing ? (
        <form action={onSave} className="flex gap-2" aria-busy={pending}>
          <Input
            name="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://… (an Amp plugin's webhook URL)"
            aria-label="Webhook URL"
            className="flex-1 h-8 text-xs"
            autoComplete="off"
            autoFocus
          />
          {/* aria-disabled while saving, not disabled, so focus stays put. */}
          <Button
            type="submit"
            size="sm"
            disabled={!url.trim()}
            aria-disabled={pending || undefined}
            className="aria-disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setEditing(false);
              setUrl("");
              setError(null);
            }}
          >
            Cancel
          </Button>
        </form>
      ) : webhook ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>Starts work when assigned · set {fmt(webhook.createdAt)}</span>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => !pending && setEditing(true)}
            aria-disabled={pending || undefined}
            className="aria-disabled:opacity-50"
          >
            Change
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => !pending && tap.confirm(onRemove, keyId)}
            aria-disabled={pending || undefined}
            className={
              tap.isArmed(keyId)
                ? `${ARMED_BUTTON} aria-disabled:opacity-50`
                : "aria-disabled:opacity-50"
            }
          >
            {tap.isArmed(keyId) ? "Confirm?" : "Remove"}
          </Button>
        </div>
      ) : (
        <Button variant="outline" size="xs" onClick={() => setEditing(true)}>
          Start work when assigned…
        </Button>
      )}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {secret && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40 p-3 space-y-2">
          <p className="text-sm font-medium">
            Copy the signing secret now — it won&apos;t be shown again.
          </p>
          <p className="text-xs text-muted-foreground">
            Sidetrack signs each request to the webhook with it. Give it to
            whatever receives them, such as the Amp plugin&apos;s secret.
          </p>
          <code className="block break-all rounded bg-background border px-2 py-1.5 text-xs font-mono select-all">
            {secret}
          </code>
          <CopyButton value={secret}>Copy</CopyButton>
          <Button variant="ghost" size="sm" onClick={() => setSecret(null)}>
            I&apos;ve copied it
          </Button>
        </div>
      )}
    </div>
  );
}
