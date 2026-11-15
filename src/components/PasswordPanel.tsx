"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { changePassword } from "@/auth/client";

/**
 * Change the signed-in user's password. Better Auth checks the current one
 * and writes the new hash; the audit row comes from the accounts trigger
 * (migration 0021). Other sessions are always signed out, as after a reset:
 * a password change usually means the old one shouldn't be trusted, and this
 * device stays signed in with a fresh session.
 */
export function PasswordPanel({ email }: { email: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // onSubmit, not a form action: an action resets the fields even on a
  // failed attempt, so a typo in "confirm" would wipe all three.
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const currentPassword = String(data.get("current") ?? "");
    const newPassword = String(data.get("password") ?? "");
    setError(null);
    setSaved(false);
    if (newPassword !== String(data.get("confirm") ?? "")) {
      setError("New passwords don't match.");
      return;
    }
    if (newPassword === currentPassword) {
      setError("Choose a password different from your current one.");
      return;
    }
    setPending(true);
    try {
      const res = await changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      if (res.error) {
        setError(
          res.error.code === "INVALID_PASSWORD"
            ? "Current password is incorrect."
            : (res.error.message ?? "Couldn't change password."),
        );
        return;
      }
      form.reset();
      setSaved(true);
    } catch {
      setError("Couldn't change password.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 rounded-lg border border-border p-4"
    >
      <h2 className="text-sm font-medium">Password</h2>
      {/* Lets password managers file the change against this account. */}
      <input
        type="text"
        name="username"
        autoComplete="username"
        value={email}
        hidden
        readOnly
      />
      <Input
        name="current"
        type="password"
        autoComplete="current-password"
        placeholder="Current password"
        aria-label="Current password"
        required
      />
      <Input
        name="password"
        type="password"
        autoComplete="new-password"
        placeholder="New password"
        aria-label="New password"
        required
        minLength={8}
      />
      <Input
        name="confirm"
        type="password"
        autoComplete="new-password"
        placeholder="Confirm new password"
        aria-label="Confirm new password"
        required
        minLength={8}
      />
      <p className="text-xs text-muted-foreground">
        At least 8 characters. Changing it signs you out on your other
        devices.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && (
        <p className="text-sm text-emerald-600 dark:text-emerald-500">
          Password changed. Your other devices are signed out.
        </p>
      )}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Changing…" : "Change password"}
      </Button>
    </form>
  );
}
