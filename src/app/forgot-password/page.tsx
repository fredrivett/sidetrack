import Link from "next/link";
import { ForgotPasswordForm } from "@/components/ForgotPasswordForm";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  // With no Resend key the reset link only appears in the server console, so
  // the form's confirmation copy points self-hosted operators there.
  const emailEnabled = Boolean(getEnv().RESEND_API_KEY);

  return (
    <main className="min-h-dvh flex items-center justify-center p-6 bg-neutral-50 dark:bg-neutral-950">
      <div className="w-full max-w-sm space-y-4 rounded-2xl bg-white dark:bg-neutral-900 p-6 shadow-sm border border-neutral-200 dark:border-neutral-800">
        <div className="space-y-1">
          <h1 className="text-lg font-medium">Reset your password</h1>
          <p className="text-sm text-muted-foreground">
            Enter your email and we&apos;ll send you a reset link.
          </p>
        </div>
        <ForgotPasswordForm emailEnabled={emailEnabled} />
        <p className="text-xs text-muted-foreground">
          Remembered it?{" "}
          <Link href="/login" className="text-foreground hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
