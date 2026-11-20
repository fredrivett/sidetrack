"use client";

import { Archive, Bell, Boxes, CalendarDays, Check, CircleUserRound, History, KeyRound, Loader2, LogOut, Moon, Sun, SunMoon, Sunrise, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { useTransition, type ComponentType } from "react";
import { useCopy } from "@/components/ui/use-copy";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GitHubMark } from "@/components/GitHubMark";
import { assigneeName, UserAvatar, type AvatarUser } from "@/components/UserAvatar";
import { signOut } from "@/auth/client";
import { forgetDrafts } from "./use-draft";
import { RELEASE } from "@/lib/release";
import { parseTheme, setTheme, THEMES, type Theme } from "@/lib/theme";
import { useTheme } from "@/components/use-theme";

const THEME_OPTIONS: Record<Theme, { label: string; Icon: typeof Sun }> = {
  system: { label: "System", Icon: SunMoon },
  light: { label: "Light", Icon: Sun },
  dark: { label: "Dark", Icon: Moon },
};

/** The settings pages, in the menu's Settings group. */
const SETTINGS_LINKS: [href: string, label: string, Icon: ComponentType<{ className?: string }>][] = [
  ["/settings/profile", "Profile", UserRound],
  ["/settings/notifications", "Notifications", Bell],
  ["/settings/greeting", "Brief greeting", Sunrise],
  ["/settings/calendars", "Calendars", CalendarDays],
  ["/settings/spaces", "Spaces", Boxes],
  ["/settings/keys", "API keys", KeyRound],
  ["/settings/github", "GitHub", GitHubMark],
];

/**
 * The avatar's menu: who's signed in, settings and theme, Activity and
 * Archived lists, sign out and the build.
 */
export function UserMenu({
  user,
  archivedCount,
  onShowArchived,
  onShowActivity,
}: {
  user: AvatarUser | null;
  /** How many lists are archived, for the Archived lists item. */
  archivedCount: number;
  /** Opens the Archived lists view. */
  onShowArchived: () => void;
  /** Opens Activity for the whole board. */
  onShowActivity: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onSignOut() {
    startTransition(async () => {
      await signOut();
      forgetDrafts();
      // The next person on this device starts as someone new in PostHog.
      posthog.reset();
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
          // else their initial. 28px (36px on touch) matches the header's
          // size="sm" buttons.
          <button
            type="button"
            aria-label="Account"
            className="shrink-0 rounded-full outline-none transition-opacity hover:opacity-80 focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {user ? (
              <UserAvatar user={user} size={28} className="touch:size-9! touch:text-lg!" />
            ) : (
              <CircleUserRound className="size-7 text-muted-foreground touch:size-9" />
            )}
          </button>
        }
      />
      {/* Roomier than the primitive's default: wider, with more padding
          either side of each row, and separators still reaching the edges. */}
      <DropdownMenuContent
        align="end"
        className="min-w-64 p-1.5 [&_[role^=menuitem]]:px-2.5 [&_[role=separator]]:-mx-1.5"
      >
        {user && (
          <>
            <div className="flex items-center gap-2.5 px-2.5 py-2">
              <UserAvatar user={user} size={32} />
              <div className="min-w-0 text-sm">
                <div className="truncate font-medium">{user.name ?? assigneeName(user)}</div>
                {user.email && (
                  <div className="truncate text-xs text-muted-foreground">{user.email}</div>
                )}
              </div>
            </div>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2.5">Settings</DropdownMenuLabel>
          {SETTINGS_LINKS.map(([href, label, Icon]) => (
            <DropdownMenuItem
              key={href}
              render={
                <Link href={href}>
                  <Icon />
                  {label}
                </Link>
              }
            />
          ))}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <ThemeIcon />
              Theme
              <DropdownMenuShortcut className="tracking-normal">
                {THEME_OPTIONS[theme].label}
              </DropdownMenuShortcut>
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
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={onShowActivity}>
            <History />
            Activity
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onShowArchived}>
            <Archive />
            Archived lists{archivedCount > 0 ? ` (${archivedCount})` : ""}
          </DropdownMenuItem>
        </DropdownMenuGroup>
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
