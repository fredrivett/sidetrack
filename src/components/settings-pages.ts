import {
  Bell,
  Boxes,
  CalendarDays,
  KeyRound,
  Mail,
  Sunrise,
  UserRound,
} from "lucide-react";
import type { ComponentType } from "react";
import { GitHubMark } from "@/components/GitHubMark";

export type SettingsPage = {
  href: string;
  label: string;
  Icon: ComponentType<{ className?: string }>;
  /** One line on the Settings index, saying what's there. */
  about: string;
};

/**
 * Every settings page, grouped as the settings sidebar and index show them.
 * The account menu lists the same pages, in the same order.
 */
export const SETTINGS_GROUPS: { label: string; pages: SettingsPage[] }[] = [
  {
    label: "Account",
    pages: [
      {
        href: "/settings/profile",
        label: "Profile",
        Icon: UserRound,
        about: "Username, avatar, password, two-factor",
      },
      {
        href: "/settings/notifications",
        label: "Notifications",
        Icon: Bell,
        about: "Push on this device, and what you hear about",
      },
    ],
  },
  {
    label: "Brief",
    pages: [
      {
        href: "/settings/greeting",
        label: "Brief greeting",
        Icon: Sunrise,
        about: "How long it is, in your own words",
      },
      {
        href: "/settings/calendars",
        label: "Calendars",
        Icon: CalendarDays,
        about: "Events your Brief knows about",
      },
    ],
  },
  {
    label: "Sharing",
    pages: [
      {
        href: "/settings/spaces",
        label: "Spaces",
        Icon: Boxes,
        about: "Share every list in a Space with the people in it",
      },
    ],
  },
  {
    label: "Connections",
    pages: [
      {
        href: "/settings/keys",
        label: "API keys",
        Icon: KeyRound,
        about: "Let MCP clients and agents use your board",
      },
      {
        href: "/settings/github",
        label: "GitHub",
        Icon: GitHubMark,
        about: "Link items to pull requests, and complete them on merge",
      },
      {
        href: "/settings/email",
        label: "Email forwarding",
        Icon: Mail,
        about: "Forward emails in to triage",
      },
    ],
  },
];

export const SETTINGS_PAGES = SETTINGS_GROUPS.flatMap((g) => g.pages);
