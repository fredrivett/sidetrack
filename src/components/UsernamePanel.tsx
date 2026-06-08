"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/auth/client";
import { USERNAME_MAX, USERNAME_MIN, validateUsername } from "@/lib/username";

type Status =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available" }
  | { kind: "taken" }
  | { kind: "invalid"; message: string }
  | { kind: "current" };

export function UsernamePanel({ initial }: { initial: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(initial);
  // Async availability result, tagged with the handle it was checked for so a
  // stale result is never shown against a newer input.
  const [avail, setAvail] = useState<{ handle: string; ok: boolean } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const unchanged = value.toLowerCase() === initial.toLowerCase();
  const formatError = value === "" ? null : validateUsername(value);

  // Debounced availability check, skipping the user's own current handle.
  // Only the async callback sets state — the synchronous status is derived
  // during render below.
  useEffect(() => {
    if (value === "" || unchanged || validateUsername(value)) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const res = await authClient.isUsernameAvailable({ username: value });
      if (cancelled) return;
      setAvail(res.error ? null : { handle: value, ok: !!res.data?.available });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [value, unchanged]);

  let status: Status;
  if (value === "") status = { kind: "idle" };
  else if (unchanged) status = { kind: "current" };
  else if (formatError) status = { kind: "invalid", message: formatError };
  else if (avail && avail.handle === value)
    status = avail.ok ? { kind: "available" } : { kind: "taken" };
  else status = { kind: "checking" };

  function onSave() {
    setError(null);
    startTransition(async () => {
      const res = await authClient.updateUser({ username: value });
      if (res.error) {
        setError(res.error.message ?? "Couldn't update username.");
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  const canSave =
    !pending && !unchanged && value !== "" && status.kind === "available";

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <label htmlFor="username" className="block text-sm font-medium">
        Username
      </label>
      <Input
        id="username"
        name="username"
        autoComplete="username"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setSaved(false);
        }}
        minLength={USERNAME_MIN}
        maxLength={USERNAME_MAX}
        aria-invalid={status.kind === "taken" || status.kind === "invalid"}
      />
      {status.kind === "checking" && (
        <p className="text-xs text-muted-foreground">Checking…</p>
      )}
      {status.kind === "available" && (
        <p className="text-xs text-emerald-600 dark:text-emerald-500">
          {value} is available.
        </p>
      )}
      {status.kind === "taken" && (
        <p className="text-xs text-destructive">{value} is taken.</p>
      )}
      {status.kind === "invalid" && (
        <p className="text-xs text-destructive">{status.message}</p>
      )}
      {status.kind === "current" && (
        <p className="text-xs text-muted-foreground">
          This is your current username.
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && (
        <p className="text-sm text-emerald-600 dark:text-emerald-500">
          Username updated.
        </p>
      )}
      <Button type="button" size="sm" onClick={onSave} disabled={!canSave}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}
