"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingEllipsis } from "@/components/ui/loading-ellipsis";
import { resetPassword } from "@/auth/client";

export function ResetPasswordForm({ token }: { token: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    const newPassword = String(formData.get("password") ?? "");
    const confirm = String(formData.get("confirm") ?? "");
    // Confirm client-side: a typo'd password here means another trip through
    // the email flow (the reset also revokes every existing session).
    if (newPassword !== confirm) {
      setError("Passwords don't match.");
      setPending(false);
      return;
    }
    try {
      const res = await resetPassword({ newPassword, token });
      if (res.error) {
        setError(res.error.message ?? "Password reset failed.");
        return;
      }
      setDone(true);
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <p className="text-sm text-muted-foreground">
        Password updated.{" "}
        <Link href="/login" className="text-foreground underline">
          Sign in
        </Link>{" "}
        with your new password.
      </p>
    );
  }

  return (
    <form action={onSubmit} className="space-y-3">
      <Input
        name="password"
        type="password"
        autoComplete="new-password"
        placeholder="New password"
        required
        minLength={8}
        autoFocus
      />
      <Input
        name="confirm"
        type="password"
        autoComplete="new-password"
        placeholder="Confirm new password"
        required
        minLength={8}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? (
          <>
            <Loader2 className="animate-spin" />
            <span>
              Updating password
              <LoadingEllipsis />
            </span>
          </>
        ) : (
          "Update password"
        )}
      </Button>
    </form>
  );
}
