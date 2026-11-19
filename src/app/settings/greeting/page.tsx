import Link from "next/link";
import { GreetingPrefsPanel } from "@/components/GreetingPrefsPanel";
import { getDb } from "@/core/db";
import { getGreetingPrefs } from "@/core/users";
import { requireUserId } from "@/auth/session";

export const dynamic = "force-dynamic";

export default async function GreetingSettingsPage() {
  const userId = await requireUserId();
  const { db } = getDb();

  return (
    <main className="min-h-dvh px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-2xl space-y-6">
        <header className="space-y-1">
          <Link href="/brief" className="text-xs text-muted-foreground hover:underline">
            ← Back to Brief
          </Link>
          <h1 className="text-lg font-semibold tracking-tight">Brief greeting</h1>
          <p className="text-sm text-muted-foreground">
            The few sentences at the top of your Brief. Tell it how you like them.
          </p>
        </header>
        <GreetingPrefsPanel initial={getGreetingPrefs(db, userId)} />
      </div>
    </main>
  );
}
