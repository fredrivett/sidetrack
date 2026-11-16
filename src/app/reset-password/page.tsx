import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell, AuthTitle } from "@/components/AuthShell";
import { ResetPasswordForm } from "@/components/ResetPasswordForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Reset password", robots: { index: false } };

// Where the emailed reset link lands: Better Auth's
// GET /api/auth/reset-password/:token validates the token and redirects here
// with ?token=… on success or ?error=INVALID_TOKEN when it's bad/expired.
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[]; error?: string | string[] }>;
}) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : undefined;
  const invalid = Boolean(params.error) || !token;

  return (
    <AuthShell>
      <AuthTitle title={invalid ? "Link expired" : "Choose a new password"}>
        {invalid ? (
          <>
            This reset link is invalid or has expired.{" "}
            <Link
              href="/forgot-password"
              className="font-medium text-foreground hover:underline"
            >
              Request a new one
            </Link>
            .
          </>
        ) : (
          <>You&apos;ll be signed out everywhere once it&apos;s set.</>
        )}
      </AuthTitle>
      {!invalid && <ResetPasswordForm token={token} />}
    </AuthShell>
  );
}
