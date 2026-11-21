import type { Metadata } from "next";
import { SettingsHeader } from "@/components/SettingsHeader";
import { NotificationLevelsPanel } from "@/components/NotificationLevelsPanel";
import { NotificationsPanel } from "@/components/NotificationsPanel";
import { getDb } from "@/core/db";
import { listNotificationLevels } from "@/core/notifications";
import { listProjects } from "@/core/projects";
import { listSpaces } from "@/core/spaces";
import { listPushDevices } from "@/core/push";
import { requireUserId } from "@/auth/session";
import { getEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Notifications" };

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
    <>
      <SettingsHeader title="Notifications" />
      <NotificationsPanel
        vapidPublicKey={vapidPublicKey}
        devices={vapidPublicKey ? listPushDevices(db, userId, vapidPublicKey) : []}
      />
      <NotificationLevelsPanel
        level={levels.all ?? "default"}
        reminders={levels.reminders ?? "all"}
        agents={levels.agents ?? "default"}
        overrides={overrides}
      />
    </>
  );
}
