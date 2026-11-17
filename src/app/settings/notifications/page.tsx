import Link from "next/link";
import { NotificationLevelsPanel } from "@/components/NotificationLevelsPanel";
import { NotificationsPanel } from "@/components/NotificationsPanel";
import { getDb } from "@/core/db";
import { listNotificationLevels } from "@/core/notifications";
import { listProjects } from "@/core/projects";
import { listSpaces } from "@/core/spaces";
import { listPushDevices } from "@/core/push";
import { requireUserId } from "@/auth/session";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const userId = await requireUserId();
  const { db } = getDb();
  // The public half, which the browser needs to subscribe. Read at runtime,
  // not built in, like every other setting.
  const vapidPublicKey = getEnv().VAPID?.publicKey ?? null;
  const levels = listNotificationLevels(db, userId);
  // Spaces, then lists, set apart from everything, among those still theirs.
  const overrides = [
    ...listSpaces(db, userId).map((s) => ({ scope: `space:${s.id}`, name: s.name, kind: "Space" as const })),
    ...listProjects(db, userId).map((p) => ({ scope: `list:${p.id}`, name: p.name, kind: "List" as const })),
  ].flatMap((o) => (levels[o.scope] ? [{ ...o, level: levels[o.scope] }] : []));

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
          vapidPublicKey={vapidPublicKey}
          devices={vapidPublicKey ? listPushDevices(db, userId, vapidPublicKey) : []}
        />
        <NotificationLevelsPanel level={levels.all ?? "default"} overrides={overrides} />
      </div>
    </main>
  );
}
