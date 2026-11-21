import type { Metadata } from "next";
import { SettingsHeader } from "@/components/SettingsHeader";
import { EmailInPanel } from "@/components/EmailInPanel";
import { getDb } from "@/core/db";
import { getEmailAddress } from "@/core/emailIn";
import { getEnv } from "@/lib/env";
import { requireUserId } from "@/auth/session";

export const metadata: Metadata = { title: "Email forwarding" };

export const dynamic = "force-dynamic";

export default async function EmailSettingsPage() {
  const userId = await requireUserId();
  const { db } = getDb();
  const domain = getEnv().EMAIL_IN?.domain ?? null;
  const address = domain ? getEmailAddress(db, userId) : null;

  return (
    <>
      <SettingsHeader title="Email forwarding">
        Forward emails to your Sidetrack address, or have a mail filter send
        them, and Sidetrack keeps them to triage against your lists.
      </SettingsHeader>
      {domain ? (
        <EmailInPanel
          address={address && { ...address, email: `${address.token}@${domain}` }}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          Email forwarding isn&apos;t set up on this server.
        </p>
      )}
    </>
  );
}
