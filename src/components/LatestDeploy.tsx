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
export function LatestDeploy() {
  const router = useRouter();
  useEffect(() => {
    let reloading = false;
    function onVisible() {
      if (document.visibilityState === "visible") router.refresh();
    }
    function onRejection(event: PromiseRejectionEvent) {
      if (!unstable_isUnrecognizedActionError(event.reason)) return;
      event.preventDefault();
      if (reloading) return;
      reloading = true;
      toast("Sidetrack was updated. Reloading…");
      setTimeout(() => location.reload(), 1000);
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
