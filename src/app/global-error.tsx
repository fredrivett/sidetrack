"use client";

import { useEffect } from "react";
import posthog from "posthog-js";

// Captures errors thrown in the root layout itself, which the route-level
// error boundary cannot reach. Must render its own <html>/<body>.
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    posthog.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-dvh flex items-center justify-center p-6 bg-neutral-50 dark:bg-neutral-950">
        <div className="w-full max-w-sm space-y-2 text-center">
          <h1 className="text-lg font-medium">Something went wrong</h1>
          <p className="text-sm text-neutral-500">Please reload the page.</p>
        </div>
      </body>
    </html>
  );
}
