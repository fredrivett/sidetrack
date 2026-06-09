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
  | { kind: "current" }
  // Same normalized handle, different casing (fred -> Fred) — a real change to
  // the display name, so it's saveable even though availability is moot.
  | { kind: "recase" }
  // Availability request failed (network/server). Non-blocking: updateUser
  // re-validates on save, so let the user try rather than locking the button.
  | { kind: "error" };

export function UsernamePanel({ initial }: { initial: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(initial);
  // Async availability result, tagged with the handle it was checked for so a
  // stale result is never shown against a newer input. `result` captures the
  // errored case explicitly so it's distinguishable from "still in flight" —
  // otherwise a failed check would look like a perpetual "checking" and lock
  // the Save button.
  const [avail, setAvail] = useState<{
    handle: string;
    result: "available" | "taken" | "error";
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // `sameHandle` = same normalized handle (possibly re-cased); `identical` =
  // byte-for-byte unchanged. A case-only edit changes display_username, so the
  // save gate keys off `identical`, while the availability check skips
  // `sameHandle` (checking your own handle would always report "taken").
  const sameHandle = value.toLowerCase() === initial.toLowerCase();
  const identical = value === initial;
  const formatError = value === "" ? null : validateUsername(value);

  // Debounced availability check, skipping the user's own current handle.
  // Only the async callback sets state — the synchronous status is derived
  // during render below.
  useEffect(() => {
    if (value === "" || sameHandle || validateUsername(value)) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const res = await authClient.isUsernameAvailable({ username: value });
      if (cancelled) return;
      setAvail({
        handle: value,
        result: res.error
          ? "error"
          : res.data?.available
            ? "available"
            : "taken",
      });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [value, sameHandle]);

  let status: Status;
  if (value === "") status = { kind: "idle" };
  else if (formatError) status = { kind: "invalid", message: formatError };
  else if (identical) status = { kind: "current" };
  else if (sameHandle) status = { kind: "recase" };
  else if (avail && avail.handle === value) status = { kind: avail.result };
  else status = { kind: "checking" };

  function onSave() {
    setError(null);
    startTransition(async () => {
      // Send displayUsername too: /update-user (unlike sign-up) does not
      // cross-fill it from username, so without this the display casing would
      // never change. `username` is normalized to lowercase server-side;
      // `displayUsername` keeps the casing the user typed.
      const res = await authClient.updateUser({
        username: value,
        displayUsername: value,
      });
      if (res.error) {
        setError(res.error.message ?? "Couldn't update username.");
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  // Allow saving on a failed availability check too — updateUser re-validates
  // server-side and surfaces "taken"/"invalid" as an error if it really is.
  const canSave =
    !pending &&
    !identical &&
    value !== "" &&
    (status.kind === "available" ||
      status.kind === "error" ||
      status.kind === "recase");

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
      {status.kind === "recase" && (
        <p className="text-xs text-muted-foreground">
          Updates how your username is capitalized.
        </p>
      )}
      {status.kind === "error" && (
        <p className="text-xs text-muted-foreground">
          Couldn&apos;t check availability — you can still try to save.
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
