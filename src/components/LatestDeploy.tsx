"use client";

import { unstable_isUnrecognizedActionError, useRouter } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";

let reloading = false;

/**
 * Reloads the page when `error` is a Server Action call this build made to a
 * newer deploy, which no longer has that action. Returns whether it did.
 */
export function reloadIfStaleDeploy(error: unknown): boolean {
  if (!unstable_isUnrecognizedActionError(error)) return false;
  if (!reloading) {
    reloading = true;
    toast("Sidetrack was updated. Reloading…");
    setTimeout(() => location.reload(), 1000);
  }
  return true;
}

// An installed app resumed from the background still runs the build it
// launched with. Refreshing when it comes back into view picks up changes made
// while it was away, and when the server is on a newer deploy, Next answers
// the refresh with a full page load of the new build. An action that beats the
// refresh to the server fails instead, and reloads.
export function LatestDeploy() {
  const router = useRouter();
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") router.refresh();
    }
    function onRejection(event: PromiseRejectionEvent) {
      if (reloadIfStaleDeploy(event.reason)) event.preventDefault();
    }
    document.addEventListener("visibilitychange", onVisible);
    addEventListener("unhandledrejection", onRejection);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      removeEventListener("unhandledrejection", onRejection);
    };
  }, [router]);
  return null;
}
