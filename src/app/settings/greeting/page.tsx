import type { Metadata } from "next";
import { SettingsHeader } from "@/components/SettingsHeader";
import { GreetingPrefsPanel } from "@/components/GreetingPrefsPanel";
import { getDb } from "@/core/db";
import { getGreetingPrefs } from "@/core/users";
import { requireUserId } from "@/auth/session";

export const metadata: Metadata = { title: "Brief greeting" };

export const dynamic = "force-dynamic";

export default async function GreetingSettingsPage() {
  const userId = await requireUserId();
  const { db } = getDb();

  return (
    <>
      <SettingsHeader title="Brief greeting">
        The few sentences at the top of your Brief. Tell it how you like them.
      </SettingsHeader>
      <GreetingPrefsPanel initial={getGreetingPrefs(db, userId)} />
    </>
  );
}
