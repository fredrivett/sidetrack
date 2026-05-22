"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createApiKeyAction,
  revokeApiKeyAction,
} from "@/app/actions";

type KeyRow = {
  id: string;
  name: string;
  prefix: string;
  createdAt: Date | number;
  lastUsedAt: Date | number | null;
};

function fmt(d: Date | number | null): string {
  if (d === null) return "never";
  const date = d instanceof Date ? d : new Date(d);
  return date.toISOString().slice(0, 10);
}

export function ApiKeysPanel({ initial }: { initial: KeyRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [justCreated, setJustCreated] = useState<{
    plaintext: string;
    name: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        setError(e instanceof Error ? e.message : "Failed to create key.");
      }
    });
  }

  function onRevoke(id: string) {
    if (!confirm("Revoke this key? Any client using it will stop working.")) {
      return;
    }
    startTransition(async () => {
      await revokeApiKeyAction(id);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-sm font-medium mb-2">Create a new key</h2>
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
            {pending ? "…" : "Create"}
          </Button>
        </form>
        {error && <p className="text-sm text-destructive mt-2">{error}</p>}
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void navigator.clipboard.writeText(justCreated.plaintext);
            }}
          >
            Copy
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setJustCreated(null)}
          >
            I&apos;ve copied it
          </Button>
        </section>
      )}

      <section>
        <h2 className="text-sm font-medium mb-2">Existing keys</h2>
        {initial.length === 0 ? (
          <p className="text-sm text-muted-foreground">No keys yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border">
            {initial.map((k) => (
              <li
                key={k.id}
                className="flex items-center justify-between gap-3 p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{k.name}</p>
                  <p className="text-xs text-muted-foreground font-mono">
                    {k.prefix}… · created {fmt(k.createdAt)} · last used{" "}
                    {fmt(k.lastUsedAt)}
                  </p>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => onRevoke(k.id)}
                  disabled={pending}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
