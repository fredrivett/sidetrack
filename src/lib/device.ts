// What the browser the app is running in is, for advice that depends on the
// device, such as how to install the app. Browser-only: call these from
// effects or event handlers, never while rendering on the server.

import type { InstallPlatform } from "../core/events";

/** An iPhone, iPad or iPod, including iPadOS, which reports itself as a Mac. */
export function isIos() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS reports itself as a Mac, but Macs have no touch screen.
    (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1)
  );
}

/** Whether the app is open in its own window, installed, not in a browser tab. */
export function isInstalled() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && navigator.standalone === true)
  );
}

/** Which installable platform this device is, or null for any other. */
export function installPlatform(): InstallPlatform | null {
  if (isIos()) return "ios";
  return /Macintosh/.test(navigator.userAgent) ? "macos" : null;
}

/** Whether this is Safari, whose Mac menu has File → Add to Dock. */
export function isSafari() {
  const ua = navigator.userAgent;
  return /Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\/|Firefox\//.test(ua);
}
