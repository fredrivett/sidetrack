import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { SettingsHeader } from "@/components/SettingsHeader";
import { SETTINGS_GROUPS } from "@/components/settings-pages";

export const metadata: Metadata = { title: "Settings" };

/** Every settings page, grouped, with a line on what each is for. */
export default function SettingsIndexPage() {
  return (
    <>
      <SettingsHeader title="Settings" />
      {SETTINGS_GROUPS.map((group) => (
        <section key={group.label} className="space-y-2">
          <h2 className="text-xs font-medium text-muted-foreground">{group.label}</h2>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {group.pages.map(({ href, label, about, Icon }) => (
              <li key={href}>
                <Link
                  href={href}
                  className="flex items-center gap-3 px-3 py-2.5 transition hover:bg-muted [&_svg]:shrink-0"
                >
                  <Icon className="size-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{label}</span>
                    <span className="block text-xs text-muted-foreground">{about}</span>
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
