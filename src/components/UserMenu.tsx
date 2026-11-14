"use client";

import { CircleUserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOut } from "@/auth/client";

export function UserMenu() {
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
          // Icon and label on desktop, just the icon on phones.
          <Button variant="outline" size="sm" aria-label="Account">
            <CircleUserRound />
            <span className="hidden sm:inline">Account</span>
          </Button>
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
