import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { TwoFactorForm } from "@/components/TwoFactorForm";
import { getCurrentSession } from "@/auth/session";
import { sanitizeNext } from "@/lib/safe-next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Two-factor sign-in", robots: { index: false } };

// Reached from LoginForm after a right password on an account with
// two-factor sign-in. Whether a sign-in is pending lives in Better Auth's
// signed two-factor cookie, which the verify endpoints check; the form says
// so when it has lapsed.
export default async function TwoFactorPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  const safeNext = sanitizeNext(next);
  if (await getCurrentSession()) redirect(safeNext);
  return (
    <AuthShell>
      <TwoFactorForm next={safeNext} />
    </AuthShell>
  );
}
