import Link from "next/link";
import { redirect } from "next/navigation";
import { UsernamePanel } from "@/components/UsernamePanel";
import { getCurrentSession } from "@/auth/session";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");

  // The username plugin adds these to the user object (returned: true).
  const user = session.user as typeof session.user & {
    username?: string | null;
    displayUsername?: string | null;
  };
  const current = user.displayUsername ?? user.username ?? "";

  return (
    <main className="min-h-dvh px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-2xl space-y-6">
        <header className="space-y-1">
          <Link
            href="/"
            className="text-xs text-muted-foreground hover:underline"
          >
            ← Back to board
          </Link>
          <h1 className="text-lg font-semibold tracking-tight">Profile</h1>
          <p className="text-sm text-muted-foreground">
            Your username identifies you and will prefix item references shared
            across accounts (e.g. <code className="font-mono">{current}/ENG-42</code>).
          </p>
        </header>
        <UsernamePanel initial={current} />
      </div>
    </main>
  );
}
