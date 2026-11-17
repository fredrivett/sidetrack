"use client";

import { Archive, Bell, Boxes, Check, CircleUserRound, KeyRound, Loader2, LogOut, Moon, Sun, SunMoon, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useCopy } from "@/components/ui/use-copy";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GitHubMark } from "@/components/GitHubMark";
import { UserAvatar, type AvatarUser } from "@/components/UserAvatar";
import { signOut } from "@/auth/client";
import { RELEASE } from "@/lib/release";
import { parseTheme, setTheme, THEMES, type Theme } from "@/lib/theme";
import { useTheme } from "@/components/use-theme";

const THEME_OPTIONS: Record<Theme, { label: string; Icon: typeof Sun }> = {
  system: { label: "System", Icon: SunMoon },
  light: { label: "Light", Icon: Sun },
  dark: { label: "Dark", Icon: Moon },
};

/**
 * The avatar's menu: settings, theme, the Archived lists view, sign out and
 * the build.
 */
export function UserMenu({
  user,
  archivedCount,
  onShowArchived,
}: {
  user: AvatarUser | null;
  /** How many lists are archived, for the Archived lists item. */
  archivedCount: number;
  /** Opens the Archived lists view. */
  onShowArchived: () => void;
}) {
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
  const release = useCopy(RELEASE);

  const theme = useTheme();
  const ThemeIcon = THEME_OPTIONS[theme].Icon;

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
            <Link href="/settings/notifications">
              <Bell />
              Notifications
            </Link>
          }
        />
        <DropdownMenuItem
          render={
            <Link href="/settings/spaces">
              <Boxes />
              Spaces
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
              <GitHubMark />
              GitHub
            </Link>
          }
        />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <ThemeIcon />
            Theme
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={theme}
              onValueChange={(next: string) => setTheme(parseTheme(next))}
            >
              {THEMES.map((value) => {
                const { label, Icon } = THEME_OPTIONS[value];
                return (
                  <DropdownMenuRadioItem key={value} value={value}>
                    <Icon />
                    {label}
                  </DropdownMenuRadioItem>
                );
              })}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onShowArchived}>
          <Archive />
          Archived lists{archivedCount > 0 ? ` (${archivedCount})` : ""}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {/* Stays open so "Signing out…" shows until the redirect to /login. */}
        <DropdownMenuItem closeOnClick={false} onClick={onSignOut} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <LogOut />}
          {pending ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {/* Which build this is, for debugging. Empty RELEASE = local dev.
            Stays open so it can show "Copied". */}
        {RELEASE ? (
          <DropdownMenuItem
            closeOnClick={false}
            className="text-xs text-muted-foreground"
            onClick={() => void release.copy()}
          >
            {release.copied ? (
              <>
                <Check />
                Copied
              </>
            ) : (
              <>Version {RELEASE.slice(0, 7)}</>
            )}
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
