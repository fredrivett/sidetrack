import type { Metadata } from "next";
import Link from "next/link";
import { LogoMark } from "@/components/LogoMark";
import { ChangelogFeed } from "@/components/ChangelogFeed";
import { loadEntries } from "@/lib/changelog";

// Public, like the landing page (src/proxy.ts). Read per request from
// changes/, which the Docker image copies next to the server.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Changelog",
  description: "What's new in Sidetrack.",
  alternates: { canonical: "/changelog" },
};

export default function ChangelogPage() {
  const entries = loadEntries();
  return (
    <div className="min-h-dvh bg-neutral-50 dark:bg-neutral-950">
      <header className="mx-auto flex w-full max-w-2xl items-center px-5 py-4 sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-md font-semibold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <LogoMark />
          Sidetrack
        </Link>
      </header>
      <main className="mx-auto max-w-2xl px-5 pb-16 pt-6 sm:px-8 sm:pt-10">
        <ChangelogFeed entries={entries} />
      </main>
    </div>
  );
}
