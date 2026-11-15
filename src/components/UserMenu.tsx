"use client";

import { CircleUserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserAvatar, type AvatarUser } from "@/components/UserAvatar";
import { signOut } from "@/auth/client";

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
        <DropdownMenuItem render={<Link href="/settings/profile">Profile</Link>} />
        <DropdownMenuItem render={<Link href="/settings/keys">API keys</Link>} />
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onSignOut} disabled={pending}>
          {pending ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
