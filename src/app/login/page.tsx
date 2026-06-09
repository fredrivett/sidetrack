import { redirect } from "next/navigation";
import { LoginForm } from "@/components/LoginForm";
import { users as authUsers } from "@/core/auth-schema";
import { getDb } from "@/core/db";
import { getEnv } from "@/lib/env";
import { sanitizeNext } from "@/lib/safe-next";
import { getCurrentSession } from "@/auth/session";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const session = await getCurrentSession();
  const { next } = await searchParams;
  const safeNext = sanitizeNext(next);
  if (session) redirect(safeNext);

  // Match the gate in src/lib/better-auth.ts: signup is shown only when the
  // operator has set ALLOW_SIGNUP=true, or no users exist yet (the very
  // first boot, where the first signup claims any pre-existing 'me' data).
  const { db } = getDb();
  const firstUser = db
    .select({ id: authUsers.id })
    .from(authUsers)
    .limit(1)
    .get();
  const allowSignUp = getEnv().ALLOW_SIGNUP || !firstUser;

  return (
    <main className="min-h-dvh flex items-center justify-center p-6 bg-neutral-50 dark:bg-neutral-950">
      <div className="w-full max-w-sm space-y-4 rounded-2xl bg-white dark:bg-neutral-900 p-6 shadow-sm border border-neutral-200 dark:border-neutral-800">
        <div className="space-y-1">
          <h1 className="text-lg font-medium">Sidetrack</h1>
          <p className="text-sm text-muted-foreground">
            {allowSignUp
              ? "Sign in or create an account."
              : "Sign in to continue."}
          </p>
        </div>
        <LoginForm allowSignUp={allowSignUp} next={safeNext} />
      </div>
    </main>
  );
}
