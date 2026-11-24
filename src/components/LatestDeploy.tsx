"use client";

import { unstable_isUnrecognizedActionError, useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";
import { isEditableTarget } from "@/lib/keyboard";
import { RELEASE } from "@/lib/release";

// An installed app resumed from the background, or a tab left open, still runs
// the build it loaded with. When the server is on a newer deploy, Next answers
// a refresh with a full page load of the new build, which throws away
// whatever was open: a dialog, a half-typed item, the scroll position. So
// background refreshes ask the server which deploy it's on first, and a page on
// an older one stops refreshing, says so (to someone signed in), and moves
// over when the user reloads or when it's next hidden with nothing in
// progress.
//
// An action that reaches the new build fails, because the new build no longer
// has that action, and reloads at once: the old page can't save anything. The
// reload keys off the server's "action not found" response header, so it
// happens however the caller handles the failed action: a toast in its own
// catch, an unhandled rejection, or the route error boundary (app/error.tsx).

let outdated = false;

/**
 * Reloads the page's data from the server, as `router.refresh()` does, unless
 * the server is on a newer deploy or can't be reached (mid-deploy, offline):
 * Next would answer either with a full page load.
 */
export async function refreshIfCurrent(router: { refresh(): void }) {
  if (outdated) return;
  let live: string;
  try {
    const response = await fetch("/api/version", { cache: "no-store" });
    if (!response.ok) return;
    live = await response.text();
  } catch {
    return;
  }
  if (live === RELEASE) router.refresh();
  else if (!outdated) {
    outdated = true;
    document.addEventListener("visibilitychange", reloadIfIdle);
    // Signed out (the landing page, sign in), there's nothing of theirs to
    // keep fresh, so it moves over unannounced. Asked only now, and anything
    // but a clear "signed out" still shows the toast.
    const signedOut = await fetch("/api/auth/get-session", { cache: "no-store" })
      .then(async (response) => response.ok && (await response.json()) === null)
      .catch(() => false);
    if (signedOut) return;
    toast("Sidetrack has been updated", {
      id: "latest-deploy",
      duration: Infinity,
      action: {
        label: (
          <span className="flex items-center gap-1">
            <RefreshCw className="size-3.5" />
            Reload
          </span>
        ),
        onClick: () => location.reload(),
      },
    });
  }
}

// Hidden, the reload goes unseen, but not while a dialog is open or a field
// is being typed in: that would still be lost.
function reloadIfIdle() {
  if (document.visibilityState !== "hidden") return;
  if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
  if (isEditableTarget(document.activeElement)) return;
  location.reload();
}

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
    // Picks up changes made while the page was out of view.
    function onVisible() {
      if (document.visibilityState === "visible") void refreshIfCurrent(router);
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
