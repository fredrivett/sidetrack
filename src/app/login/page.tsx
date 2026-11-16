import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { LoginForm } from "@/components/LoginForm";
import { sanitizeNext } from "@/lib/safe-next";
import { getCurrentSession } from "@/auth/session";
import { isSignUpOpen } from "@/auth/signup";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    next?: string | string[];
    mode?: string | string[];
  }>;
}) {
  const session = await getCurrentSession();
  const { next, mode } = await searchParams;
  const safeNext = sanitizeNext(next);
  if (session) redirect(safeNext);

  const allowSignUp = isSignUpOpen();

  return (
    <AuthShell>
      {/* ?mode=sign-up, as the landing page links, opens on signup. */}
      <LoginForm
        allowSignUp={allowSignUp}
        initialMode={allowSignUp && mode === "sign-up" ? "sign-up" : "sign-in"}
        next={safeNext}
      />
    </AuthShell>
  );
}
