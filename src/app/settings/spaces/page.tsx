import type { Metadata } from "next";
import { SettingsHeader } from "@/components/SettingsHeader";
import { SpacesPanel } from "@/components/SpacesPanel";
import { getDb } from "@/core/db";
import { listSpaces } from "@/core/spaces";
import { requireUserId } from "@/auth/session";

export const metadata: Metadata = { title: "Spaces" };

export const dynamic = "force-dynamic";

export default async function SpacesPage() {
  const userId = await requireUserId();
  const { db } = getDb();

  return (
    <>
      <SettingsHeader title="Spaces">
        A space shares every list in it with everyone in it, such as a household or a
        small team. Admins invite and remove people, and choose what each can do: edit
        the lists, or only comment on or view them.
      </SettingsHeader>
      <SpacesPanel spaces={listSpaces(db, userId)} viewerId={userId} />
    </>
  );
}
