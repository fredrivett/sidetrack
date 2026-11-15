"use client";

import { CircleUserRound, KeyRound, Loader2, LogOut, UserRound, Webhook } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserAvatar, type AvatarUser } from "@/components/UserAvatar";
import { signOut } from "@/auth/client";
import { RELEASE } from "@/lib/release";

export function UserMenu({ user }: { user: AvatarUser | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onSignOut() {
    startTransition(async () => {
      await signOut();
      router.push("/login");
      router.refresh();
    });
  }

  // The full SHA, for pasting into a bug report, an agent thread, or `git show`.
  async function onCopyRelease() {
    try {
      await navigator.clipboard.writeText(RELEASE);
      toast.success(`Copied ${RELEASE.slice(0, 7)}`);
    } catch {
      toast.error("Couldn't copy the version.");
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          // The avatar is the button: the user's image once set (Profile),
          // else their initial. 28px matches the header's size="sm" buttons.
          <button
            type="button"
            aria-label="Account"
            className="shrink-0 rounded-full outline-none transition-opacity hover:opacity-80 focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {user ? (
              <UserAvatar user={user} size={28} />
            ) : (
              <CircleUserRound className="size-7 text-muted-foreground" />
            )}
          </button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          render={
            <Link href="/settings/profile">
              <UserRound />
              Profile
            </Link>
          }
        />
        <DropdownMenuItem
          render={
            <Link href="/settings/keys">
              <KeyRound />
              API keys
            </Link>
          }
        />
        <DropdownMenuItem
          render={
            <Link href="/settings/github">
              <Webhook />
              GitHub
            </Link>
          }
        />
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onSignOut} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <LogOut />}
          {pending ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {/* Which build this is, for debugging. Empty RELEASE = local dev. */}
        {RELEASE ? (
          <DropdownMenuItem
            className="text-xs text-muted-foreground"
            onClick={onCopyRelease}
          >
            Version {RELEASE.slice(0, 7)}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem disabled className="text-xs">
            Version dev
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
