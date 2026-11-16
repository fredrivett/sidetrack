import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell, AuthTitle } from "@/components/AuthShell";
import { ForgotPasswordForm } from "@/components/ForgotPasswordForm";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Forgot password", robots: { index: false } };

export default function ForgotPasswordPage() {
  // With no Resend key the reset link only appears in the server console, so
  // the form's confirmation copy points self-hosted operators there.
  const emailEnabled = Boolean(getEnv().RESEND_API_KEY);

  return (
    <AuthShell>
      <AuthTitle title="Reset your password">
        Enter your email and we&apos;ll send you a reset link.
      </AuthTitle>
      <ForgotPasswordForm emailEnabled={emailEnabled} />
      <p className="border-t border-neutral-200 pt-4 text-center text-sm text-muted-foreground dark:border-neutral-800">
        Remembered it?{" "}
        <Link href="/login" className="font-medium text-foreground hover:underline">
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}
