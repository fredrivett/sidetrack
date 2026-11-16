import type { ReactNode } from "react";
import Link from "next/link";
import { LogoMark } from "@/components/LogoMark";

// The frame of the signed-out account pages (sign in, sign up, forgot and
// reset password): the logo, linking home, above one card. No hooks, so
// server pages and client forms can both use it.

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="relative isolate flex min-h-dvh flex-col items-center justify-center px-4 py-10 sm:px-6">
      <DotGrid />
      <Link
        href="/"
        className="mb-6 flex items-center gap-2.5 rounded-md text-lg font-semibold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <LogoMark className="h-[28.5px] w-[27px]" />
        Sidetrack
      </Link>
      <div className="w-full max-w-sm space-y-5 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm sm:p-7 dark:border-neutral-800 dark:bg-neutral-900">
        {children}
      </div>
    </main>
  );
}

/** A card's heading and the line under it. */
export function AuthTitle({
  title,
  children,
}: {
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="space-y-1 text-center">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {children && <p className="text-sm text-muted-foreground">{children}</p>}
    </div>
  );
}

/** A faint dot grid behind the page, fading out towards the edges. */
export function DotGrid({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(var(--color-neutral-300)_1px,transparent_1px)] [background-size:20px_20px] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)] dark:bg-[radial-gradient(var(--color-neutral-800)_1px,transparent_1px)] ${className}`}
    />
  );
}
