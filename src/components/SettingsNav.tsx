"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { SETTINGS_GROUPS } from "./settings-pages";

/**
 * The settings sidebar, on screens wide enough for one: every settings page,
 * grouped, with the open one marked. Phones get the Settings index instead,
 * which the back link above each page returns to.
 */
export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings" className="hidden md:block">
      <div className="sticky top-6 space-y-5">
        {SETTINGS_GROUPS.map((group) => (
          <div key={group.label} className="space-y-1">
            <h2 className="px-2 text-xs font-medium text-muted-foreground">{group.label}</h2>
            <ul className="space-y-0.5">
              {group.pages.map(({ href, label, Icon }) => {
                const current = pathname === href;
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      aria-current={current ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground [&_svg]:size-4 [&_svg]:shrink-0",
                        current && "bg-muted font-medium text-foreground",
                      )}
                    >
                      <Icon />
                      {label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}

/**
 * The way out, above every settings page: back to the board, or on a phone,
 * where there's no sidebar, back to the Settings index first.
 */
export function SettingsBack() {
  const pathname = usePathname();
  const onIndex = pathname === "/settings";
  const link = "inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline";
  return (
    <>
      <Link href="/" className={cn(link, !onIndex && "hidden md:inline-flex")}>
        <ArrowLeft className="size-3.5" />
        Back to board
      </Link>
      {!onIndex && (
        <Link href="/settings" className={cn(link, "md:hidden")}>
          <ArrowLeft className="size-3.5" />
          Settings
        </Link>
      )}
    </>
  );
}
