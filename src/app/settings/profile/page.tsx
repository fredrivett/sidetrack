import type { Metadata } from "next";
import { SettingsHeader } from "@/components/SettingsHeader";
import { redirect } from "next/navigation";
import { AvatarPanel } from "@/components/AvatarPanel";
import { InvitesPanel } from "@/components/InvitesPanel";
import { PasswordPanel } from "@/components/PasswordPanel";
import { TwoFactorPanel } from "@/components/TwoFactorPanel";
import { UsernamePanel } from "@/components/UsernamePanel";
import { getCurrentSession } from "@/auth/session";
import { getDb } from "@/core/db";
import { invitedBy, invitedPeople } from "@/core/invitations";
import { getUserNumber } from "@/core/users";
import { getEnv } from "@/lib/env";
import { foundingBatch } from "@/lib/founding";

export const metadata: Metadata = { title: "Profile" };

export const dynamic = "force-dynamic";

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ setup?: string | string[] }>;
}) {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  // Get started's "Secure your account" card opens two-factor setup here.
  const { setup } = await searchParams;

  // The username plugin adds these to the user object (returned: true).
  const user = session.user as typeof session.user & {
    username?: string | null;
    displayUsername?: string | null;
  };
  const current = user.displayUsername ?? user.username ?? "";
  // A founding member keeps their batch and number: "Earliest adopter #4".
  const userNumber = getEnv().FOUNDING_SEATS ? getUserNumber(getDb().db, user.id) : null;
  const founding = userNumber === null ? null : foundingBatch(userNumber);

  return (
    <>
      <SettingsHeader title="Profile">
        Your username identifies you and will prefix item references shared
        across accounts (e.g. <code className="font-mono">{current}/ENG-42</code>).
      </SettingsHeader>
      {founding && (
        <p className="-mt-4 text-sm font-medium">
          {founding.batch.member} #{userNumber}
        </p>
      )}
      <UsernamePanel initial={current} />
      <AvatarPanel
        user={{
          userId: user.id,
          displayUsername: user.displayUsername ?? null,
          name: user.name,
          email: user.email,
          image: user.image ?? null,
        }}
      />
      <InvitesPanel invitedBy={invitedBy(getDb().db, user.id)} invited={invitedPeople(getDb().db, user.id)} />
      <PasswordPanel email={user.email} />
      <TwoFactorPanel
        email={user.email}
        enabled={user.twoFactorEnabled ?? false}
        startSetup={setup === "two-factor"}
      />
    </>
  );
}
