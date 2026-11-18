import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FoundingTicket } from "@/components/FoundingTicket";
import { LoginForm } from "@/components/LoginForm";
import { sanitizeNext } from "@/lib/safe-next";
import { getCurrentSession } from "@/auth/session";
import { isSignUpOpen } from "@/auth/signup";
import { getDb } from "@/core/db";
import { nextUserNumber } from "@/core/users";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

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
    // ?mode=sign-up, as the landing page links, opens on signup.
    <LoginForm
      allowSignUp={allowSignUp}
      initialMode={allowSignUp && mode === "sign-up" ? "sign-up" : "sign-in"}
      next={safeNext}
      signUpAbove={
        allowSignUp && getEnv().FOUNDING_SEATS ? (
          <FoundingTicket next={nextUserNumber(getDb().db)} />
        ) : undefined
      }
    />
  );
}
