import Link from "next/link";
import { EmailInPanel } from "@/components/EmailInPanel";
import { getDb } from "@/core/db";
import { getEmailAddress } from "@/core/emailIn";
import { getEnv } from "@/lib/env";
import { requireUserId } from "@/auth/session";

export const dynamic = "force-dynamic";

export default async function EmailSettingsPage() {
  const userId = await requireUserId();
  const { db } = getDb();
  const domain = getEnv().EMAIL_IN?.domain ?? null;
  const address = domain ? getEmailAddress(db, userId) : null;

  return (
    <main className="min-h-dvh px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-2xl space-y-6">
        <header className="space-y-1">
          <Link href="/" className="text-xs text-muted-foreground hover:underline">
            ← Back to board
          </Link>
          <h1 className="text-lg font-semibold tracking-tight">Email forwarding</h1>
          <p className="text-sm text-muted-foreground">
            Forward emails to your Sidetrack address, or have a mail filter send
            them, and Sidetrack keeps them to triage against your lists.
          </p>
        </header>
        {domain ? (
          <EmailInPanel
            address={address && { ...address, email: `${address.token}@${domain}` }}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            Email forwarding isn&apos;t set up on this server.
          </p>
        )}
      </div>
    </main>
  );
}
