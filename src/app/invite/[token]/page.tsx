import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/auth/session";
import { AuthShell, AuthTitle } from "@/components/AuthShell";
import { InviteAccept } from "@/components/InviteAccept";
import { LoginForm } from "@/components/LoginForm";
import { UserAvatar } from "@/components/UserAvatar";
import { getDb } from "@/core/db";
import { findInvitation, type InvitationLink } from "@/core/invitations";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "You're invited", robots: { index: false } };

/** What the invite is for, in a sentence: their day, some places, or just Sidetrack. */
function forWords(invite: InvitationLink): string {
  const who = invite.inviter.name;
  if (invite.within) {
    return `${who} wants to share their ${invite.within === "week" ? "week" : "day"} with you: what they're getting done, as it happens. Follow along and leave them a comment.`;
  }
  if (invite.places.length) return `${who} invited you to share ${invite.places.join(", ")} on Sidetrack.`;
  return `${who} invited you to join them on Sidetrack.`;
}

/** Who's inviting, and what for: above the sign-up card, or the card itself when signed in. */
function InviteHeader({ invite }: { invite: InvitationLink }) {
  return (
    <div className="flex w-full max-w-sm items-center gap-3 rounded-2xl border border-neutral-200 bg-white px-4 py-3 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <UserAvatar
        user={{ userId: invite.inviter.id, displayUsername: invite.inviter.username, name: invite.inviter.name, email: null, image: invite.inviter.image }}
        size={36}
      />
      <p className="min-w-0 text-sm">{forWords(invite)}</p>
    </div>
  );
}

/**
 * An invite's link, from its email. Signed out, it's sign-up (open even on a
 * closed instance, for this invite), which accepts it; signing in instead
 * comes back here. Signed in, it's Accept.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = findInvitation(getDb().db, token);
  const session = await getCurrentSession();

  if (!invite || invite.status !== "open") {
    // Their own, just used to sign up: on to what it shared.
    if (invite && session && invite.acceptedBy === session.user.id) redirect(invite.within ? "/check-ins" : "/");
    return (
      <AuthShell>
        <AuthTitle title="This invite has expired or been used">
          {invite ? `Ask ${invite.inviter.name} to send it again.` : "Ask whoever sent it to send it again."}
        </AuthTitle>
        <p className="border-t border-neutral-200 pt-4 text-center text-sm text-muted-foreground dark:border-neutral-800">
          <Link href="/login" className="font-medium text-foreground hover:underline">
            Sign in
          </Link>
        </p>
      </AuthShell>
    );
  }

  if (session) {
    const own = session.user.id === invite.inviter.id;
    return (
      <AuthShell above={<InviteHeader invite={invite} />}>
        <AuthTitle title={own ? "This is your own invite" : `Accept ${invite.inviter.name}'s invite`}>
          {own ? `Send this link to ${invite.email}.` : `You're signed in as ${session.user.email}.`}
        </AuthTitle>
        {!own && <InviteAccept token={token} label={invite.within ? `See ${invite.inviter.name}'s ${invite.within === "week" ? "week" : "day"}` : "Accept"} />}
      </AuthShell>
    );
  }

  return (
    <LoginForm
      allowSignUp
      initialMode="sign-up"
      next={`/invite/${token}`}
      invite={{ token, email: invite.email, above: <InviteHeader invite={invite} /> }}
    />
  );
}
