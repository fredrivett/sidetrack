import Link from "next/link";
import { NotificationsPanel } from "@/components/NotificationsPanel";
import { getDb } from "@/core/db";
import { listPushDevices } from "@/core/push";
import { requireUserId } from "@/auth/session";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const userId = await requireUserId();
  const { db } = getDb();

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
          <h1 className="text-lg font-semibold tracking-tight">Notifications</h1>
        </header>
        <NotificationsPanel
          // The public half, which the browser needs to subscribe. Read at
          // runtime, not built in, like every other setting.
          vapidPublicKey={getEnv().VAPID?.publicKey ?? null}
          devices={listPushDevices(db, userId)}
        />
      </div>
    </main>
  );
}
