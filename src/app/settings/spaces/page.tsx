import Link from "next/link";
import { SpacesPanel } from "@/components/SpacesPanel";
import { getDb } from "@/core/db";
import { listSpaces } from "@/core/spaces";
import { requireUserId } from "@/auth/session";

export const dynamic = "force-dynamic";

export default async function SpacesPage() {
  const userId = await requireUserId();
  const { db } = getDb();

  return (
    <main className="min-h-dvh px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-2xl space-y-6">
        <header className="space-y-1">
          <Link href="/" className="text-xs text-muted-foreground hover:underline">
            ← Back to board
          </Link>
          <h1 className="text-lg font-semibold tracking-tight">Spaces</h1>
          <p className="text-sm text-muted-foreground">
            A space shares every list in it with everyone in it, such as a household or a
            small team. Admins invite and remove people; everyone can see and edit the
            lists.
          </p>
        </header>
        <SpacesPanel spaces={listSpaces(db, userId)} viewerId={userId} />
      </div>
    </main>
  );
}
