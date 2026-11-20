// What the browser the app is running in is, for advice that depends on the
// device, such as how to install the app. Browser-only: call these from
// effects or event handlers, never while rendering on the server.

import type { InstallPlatform } from "./getStarted";

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

/** An Android phone or tablet. */
export function isAndroid() {
  return /Android/.test(navigator.userAgent);
}

/** Whether this device installs the app to a Home Screen (phone) or a computer. */
export function installPlatform(): InstallPlatform {
  return isIos() || isAndroid() ? "phone" : "computer";
}

/** Whether this is Firefox, which can't install the app on a computer. */
export function isFirefox() {
  return /Firefox\//.test(navigator.userAgent);
}

/** Whether this is Safari: on a Mac, File → Add to Dock; on iOS, Share → Add to Home Screen. */
export function isSafari() {
  const ua = navigator.userAgent;
  return /Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\/|Firefox\//.test(ua);
}
