import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Replaces Next's built-in 404, which brings its own inline system font.
export default function NotFound() {
  return (
    <main className="min-h-dvh flex items-center justify-center p-6 bg-neutral-50 dark:bg-neutral-950">
      <div className="w-full max-w-sm space-y-4 rounded-2xl bg-white dark:bg-neutral-900 p-6 shadow-sm border border-neutral-200 dark:border-neutral-800 text-center">
        <h1 className="text-lg font-medium">Page not found</h1>
        <p className="text-sm text-neutral-500">
          There&apos;s nothing at this address.
        </p>
        <Link href="/" className={cn(buttonVariants({ variant: "outline" }))}>
          Back to board
        </Link>
      </div>
    </main>
  );
}
