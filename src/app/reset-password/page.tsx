import Link from "next/link";
import { ResetPasswordForm } from "@/components/ResetPasswordForm";

export const dynamic = "force-dynamic";

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
    <main className="min-h-dvh flex items-center justify-center p-6 bg-neutral-50 dark:bg-neutral-950">
      <div className="w-full max-w-sm space-y-4 rounded-2xl bg-white dark:bg-neutral-900 p-6 shadow-sm border border-neutral-200 dark:border-neutral-800">
        <div className="space-y-1">
          <h1 className="text-lg font-medium">
            {invalid ? "Link expired" : "Choose a new password"}
          </h1>
          {invalid ? (
            <p className="text-sm text-muted-foreground">
              This reset link is invalid or has expired.{" "}
              <Link
                href="/forgot-password"
                className="text-foreground hover:underline"
              >
                Request a new one
              </Link>
              .
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              You&apos;ll be signed out everywhere once it&apos;s set.
            </p>
          )}
        </div>
        {!invalid && <ResetPasswordForm token={token} />}
      </div>
    </main>
  );
}
