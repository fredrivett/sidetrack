import type { ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Bot, History, Server, Sparkles, Star } from "lucide-react";
import { DotGrid } from "@/components/AuthShell";
import { GitHubMark } from "@/components/GitHubMark";
import { LogoMark } from "@/components/LogoMark";
import { buttonVariants } from "@/components/ui/button";
import { getCurrentSession } from "@/auth/session";
import { isSignUpOpen } from "@/auth/signup";
import { dayOf } from "@/lib/time";
import { cn } from "@/lib/utils";
import { appBaseUrl, SITE_DESCRIPTION } from "../site";
import { PreviewBoard } from "./PreviewBoard";

// The landing page. src/proxy.ts shows it at / to signed-out visitors (the
// board is / once signed in); it's also reachable here directly.

export const dynamic = "force-dynamic";

// The description, Open Graph and social card come from the root layout.
// The canonical URL is /, where signed-out visitors see this page.
export const metadata: Metadata = {
  title: { absolute: "Sidetrack · the home for everything you get sidetracked by" },
  alternates: { canonical: "/" },
};

const REPO = "https://github.com/fredrivett/sidetrack";

// The repo's star count, kept for an hour: unauthenticated GitHub API calls
// are limited to 60 an hour, and the page renders per request.
const STARS_TTL_MS = 60 * 60 * 1000;
// Holds the lookup itself, not its result, so renders that arrive while it's
// in flight share it instead of each calling GitHub.
let starsCache: { stars: Promise<number | null>; at: number } | null = null;

function repoStars(): Promise<number | null> {
  if (!starsCache || Date.now() - starsCache.at >= STARS_TTL_MS) {
    starsCache = { stars: fetchRepoStars(), at: Date.now() };
  }
  return starsCache.stars;
}

/** The repo's stars, or null when GitHub doesn't answer within a second. */
async function fetchRepoStars(): Promise<number | null> {
  let stars: number | null = null;
  try {
    const res = await fetch("https://api.github.com/repos/fredrivett/sidetrack", {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(1000),
    });
    if (res.ok) {
      const { stargazers_count } = (await res.json()) as { stargazers_count?: unknown };
      if (typeof stargazers_count === "number") stars = stargazers_count;
    }
  } catch {
    // Offline or slow: show the badge without a count.
  }
  return stars;
}

/**
 * When this page renders, as a time and the server's day. The preview's
 * dates count from here, so its server render and the browser's match; due
 * labels still read from the visitor's own day.
 */
function renderedAt() {
  const now = Date.now();
  return { now, today: dayOf(now) };
}

export default async function Welcome() {
  const [session, stars, url] = await Promise.all([
    getCurrentSession(),
    repoStars(),
    appBaseUrl(),
  ]);
  const signedIn = Boolean(session);
  const { now, today } = renderedAt();
  // Self-hosted instances usually lock signup after the first account, so
  // the call to action falls back to signing in.
  const cta = signedIn
    ? { href: "/", label: "Open your board" }
    : isSignUpOpen()
      ? { href: "/login?mode=sign-up", label: "Get started" }
      : { href: "/login", label: "Sign in" };

  return (
    <div className="relative isolate flex min-h-dvh flex-col overflow-x-hidden">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: structuredData(`${url}/`) }}
      />
      <DotGrid className="h-[44rem] [mask-image:radial-gradient(ellipse_at_top,black_10%,transparent_65%)]" />

      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-4 sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-md font-semibold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <LogoMark />
          Sidetrack
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2">
          <a
            href={REPO}
            className="mr-1 flex h-7 items-center gap-1.5 rounded-full border border-neutral-200 bg-white/60 px-2.5 text-xs font-medium text-muted-foreground tabular-nums outline-none transition-colors hover:border-neutral-300 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 dark:border-neutral-800 dark:bg-neutral-900/60 dark:hover:border-neutral-700"
            aria-label={
              stars === null ? "Sidetrack on GitHub" : `Sidetrack on GitHub, ${stars} ${stars === 1 ? "star" : "stars"}`
            }
          >
            <GitHubMark className="size-3.5" />
            {stars !== null && (
              <span className="flex items-center gap-1">
                <Star className="size-3 fill-current" aria-hidden />
                {new Intl.NumberFormat("en", { notation: "compact" }).format(stars)}
              </span>
            )}
          </a>
          {!signedIn && cta.href !== "/login" && (
            <Link href="/login" className={buttonVariants({ variant: "ghost" })}>
              Sign in
            </Link>
          )}
          <Link href={cta.href} className={buttonVariants()}>
            {cta.label}
          </Link>
        </nav>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-5xl px-5 pt-14 text-center sm:px-8 sm:pt-20">
          <LogoMark className="mx-auto mb-8 h-[57px] w-[54px] [&_rect]:motion-safe:animate-[slide-in_700ms_cubic-bezier(0.2,0.8,0.2,1)_both] [&_rect:nth-child(even)]:[--slide-from:-96px_0] [&_rect:nth-child(odd)]:[--slide-from:96px_0] [&_rect:nth-child(2)]:[animation-delay:70ms] [&_rect:nth-child(3)]:[animation-delay:140ms] [&_rect:nth-child(4)]:[animation-delay:210ms] [&_rect:nth-child(5)]:[animation-delay:280ms]" />
          <p className="mb-5 text-xs font-medium uppercase tracking-[0.18em] text-balance text-muted-foreground">
            {/* Each phrase keeps its dot, so phones wrap between phrases and
                never start a line with a dot. */}
            <span className="whitespace-nowrap">Open source ·</span>{" "}
            <span className="whitespace-nowrap">Self-hostable ·</span>{" "}
            <span className="whitespace-nowrap">Agent native</span>
          </p>
          <h1 className="mx-auto max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
            The home for everything you get sidetracked by.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base text-pretty text-muted-foreground sm:text-lg">
            Every project, every person,{" "}
            <span className="whitespace-nowrap">every agent.</span>{" "}
            <span className="whitespace-nowrap">One board for all of it.</span>
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href={cta.href}
              className={cn(buttonVariants({ size: "lg" }), "h-10 px-4 text-[0.95rem]")}
            >
              {cta.label}
              <ArrowRight data-icon="inline-end" />
            </Link>
            <a
              href={REPO}
              className={cn(
                buttonVariants({ variant: "outline", size: "lg" }),
                "h-10 px-4 text-[0.95rem]",
              )}
            >
              <GitHubMark className="size-4" />
              Host your own
            </a>
          </div>
        </section>

        {/* The real board on made-up lists, to try out (see PreviewBoard).
            Wider than the text so its three lists fit side by side. It
            rises in by `top`, not slide-in's translate, which would offset
            the dragged card's overlay (see rise-in). */}
        <section
          aria-label="A sample board to try"
          className="relative top-0 mx-auto mt-16 max-w-6xl px-5 motion-safe:animate-[rise-in_600ms_cubic-bezier(0.2,0.8,0.2,1)_backwards] [animation-delay:150ms] sm:mt-20 sm:px-8"
        >
          <PreviewBoard today={today} now={now} />
          {/* What the agent on FIX-12 last reported, below its list. */}
          <div className="absolute -bottom-14 right-10 w-72 rotate-1 rounded-xl border border-neutral-200 bg-white p-3 text-left text-sm shadow-lg motion-safe:animate-[slide-in_500ms_cubic-bezier(0.2,0.8,0.2,1)_both] [--slide-from:0_12px] [animation-delay:1100ms] max-sm:hidden dark:border-neutral-800 dark:bg-neutral-900">
            <p className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Sparkles className="size-3.5 text-violet-500" />
              Amp, working on FIX-12
            </p>
            <p>
              Two of the three roofers have quoted. Chasing the third, then
              I&apos;ll compare them on the item.
            </p>
          </div>
        </section>

        <section className="mx-auto grid max-w-5xl gap-8 px-5 py-20 sm:grid-cols-3 sm:gap-10 sm:px-8 sm:py-28">
          <Feature icon={<Bot />} title="Built for agents">
            A built-in MCP server lets Claude, Amp and friends add, update and
            close items from wherever you&apos;re already working.
          </Feature>
          <Feature icon={<History />} title="Nothing slips by">
            Every change is logged, whether you made it or an agent did, so you
            always know who moved what, and when.
          </Feature>
          <Feature icon={<Server />} title="Yours to run">
            One Docker container and a SQLite file. Install it on your phone
            as an app, and share lists with the people you build with.
          </Feature>
        </section>
      </main>

      <footer className="border-t border-neutral-200 dark:border-neutral-800">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-5 py-6 text-sm text-muted-foreground sm:px-8">
          <span className="flex items-center gap-2">
            <LogoMark className="h-[14.25px] w-[13.5px]" />
            Sidetrack is open source under AGPL-3.0.
          </span>
          <a href={REPO} className="flex items-center gap-1.5 hover:text-foreground">
            <GitHubMark className="size-3.5" />
            fredrivett/sidetrack
          </a>
        </div>
      </footer>
    </div>
  );
}

/**
 * What search engines read about the site: its name (shown above results)
 * and what Sidetrack is. `<` is escaped so no text can close the script tag.
 */
function structuredData(url: string) {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebSite", name: "Sidetrack", url },
      {
        "@type": "SoftwareApplication",
        name: "Sidetrack",
        url,
        description: SITE_DESCRIPTION,
        applicationCategory: "ProductivityApplication",
        operatingSystem: "Web",
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        license: "https://www.gnu.org/licenses/agpl-3.0.html",
        sameAs: [REPO],
      },
    ],
  }).replace(/</g, "\\u003c");
}

function Feature({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="mb-3 flex size-9 items-center justify-center rounded-lg border border-neutral-200 bg-white shadow-xs dark:border-neutral-800 dark:bg-neutral-900 [&_svg]:size-4.5">
        {icon}
      </div>
      <h2 className="font-semibold tracking-tight">{title}</h2>
      <p className="text-sm leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}
