"use client";

import { useEffect } from "react";

// Registers public/sw.js, which caches the /launch skeleton for the installed
// app. Production only: the dev server serves changing CSS at fixed URLs, which
// the worker would keep serving from its cache.
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .catch(() => {});
  }, []);
  return null;
}
