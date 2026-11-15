"use client";

import { unstable_isUnrecognizedActionError } from "next/navigation";
import { useEffect } from "react";
import posthog from "posthog-js";
import { Button } from "@/components/ui/button";

// Route error boundary. Captures the error to PostHog (a no-op unless capture
// is configured — see instrumentation-client.ts) and offers a retry. An action
// the server no longer has means a newer deploy, which LatestDeploy is already
// reloading into, so that shows nothing.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const newDeploy = unstable_isUnrecognizedActionError(error);
  useEffect(() => {
    if (!newDeploy) posthog.captureException(error);
  }, [error, newDeploy]);

  if (newDeploy) return null;

  return (
    <main className="min-h-dvh flex items-center justify-center p-6 bg-neutral-50 dark:bg-neutral-950">
      <div className="w-full max-w-sm space-y-4 rounded-2xl bg-white dark:bg-neutral-900 p-6 shadow-sm border border-neutral-200 dark:border-neutral-800 text-center">
        <h1 className="text-lg font-medium">Something went wrong</h1>
        <p className="text-sm text-neutral-500">
          An unexpected error occurred. Try again, or reload the page.
        </p>
        <Button variant="outline" onClick={reset}>
          Try again
        </Button>
      </div>
    </main>
  );
}
