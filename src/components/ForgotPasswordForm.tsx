"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingEllipsis } from "@/components/ui/loading-ellipsis";
import { requestPasswordReset } from "@/auth/client";

export function ForgotPasswordForm({
  emailEnabled,
}: {
  // Whether the server can actually send email (Resend configured). Without
  // it the reset link is logged to the server console, so point self-hosted
  // operators there instead of at an inbox that will stay empty.
  emailEnabled: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function onSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    const email = String(formData.get("email") ?? "").trim();
    try {
      // The server answers identically whether or not the account exists
      // (anti-enumeration), so success here just means "request accepted".
      const res = await requestPasswordReset({
        email,
        redirectTo: "/reset-password",
      });
      if (res.error) {
        setError(res.error.message ?? "Something went wrong. Try again.");
        return;
      }
      setSent(true);
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return (
      <p className="text-sm text-muted-foreground">
        {emailEnabled
          ? "If an account exists for that email, a reset link is on its way. The link expires in 1 hour."
          : "If an account exists for that email, a reset link has been logged to the server console. The link expires in 1 hour."}
      </p>
    );
  }

  return (
    <form action={onSubmit} className="space-y-3">
      <Input
        name="email"
        type="email"
        autoComplete="email"
        placeholder="Email"
        required
        autoFocus
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? (
          <>
            <Loader2 className="animate-spin" />
            <span>
              Sending
              <LoadingEllipsis />
            </span>
          </>
        ) : (
          "Send reset link"
        )}
      </Button>
    </form>
  );
}
