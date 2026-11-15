"use client";

import { unstable_isUnrecognizedActionError, useRouter } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";

// An installed app resumed from the background still runs the build it
// launched with. Refreshing when it comes back into view picks up changes made
// while it was away, and when the server is on a newer deploy, Next answers
// the refresh with a full page load of the new build. An action that beats the
// refresh to the server fails instead, because the new build no longer has
// that action, and reloads.
//
// The reload keys off the server's "action not found" response header, so it
// happens however the caller handles the failed action: a toast in its own
// catch, an unhandled rejection, or the route error boundary (app/error.tsx).
export function LatestDeploy() {
  const router = useRouter();
  useEffect(() => {
    let reloading = false;
    const { fetch } = window;
    window.fetch = async (...args) => {
      const response = await fetch.apply(window, args);
      if (response.headers.get("x-nextjs-action-not-found") === "1" && !reloading) {
        reloading = true;
        toast("Sidetrack was updated. Reloading…");
        setTimeout(() => location.reload(), 1000);
      }
      return response;
    };
    function onVisible() {
      if (document.visibilityState === "visible") router.refresh();
    }
    // Already reloading, so not an error worth reporting.
    function onRejection(event: PromiseRejectionEvent) {
      if (unstable_isUnrecognizedActionError(event.reason)) event.preventDefault();
    }
    document.addEventListener("visibilitychange", onVisible);
    addEventListener("unhandledrejection", onRejection);
    return () => {
      window.fetch = fetch;
      document.removeEventListener("visibilitychange", onVisible);
      removeEventListener("unhandledrejection", onRejection);
    };
  }, [router]);
  return null;
}
