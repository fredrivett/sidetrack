"use client";

import posthog from "posthog-js";
import { useEffect } from "react";

// Registers public/sw.js, which caches the /launch skeleton for the installed
// app and shows push notifications. In development it registers it without
// its cache (/sw.js?dev), for push alone: the dev server serves changing CSS
// at fixed URLs, which the worker would keep serving from its cache.
export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const url = process.env.NODE_ENV === "production" ? "/sw.js" : "/sw.js?dev";
    navigator.serviceWorker
      .register(url, { updateViaCache: "none" })
      .catch((error) => posthog.captureException(error));
  }, []);
  return null;
}
