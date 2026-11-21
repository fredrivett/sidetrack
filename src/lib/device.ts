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

/** Microsoft Edge, whose install is under … → Apps rather than Chrome's menu. */
export function isEdge() {
  return /Edg\//.test(navigator.userAgent);
}

/** Chrome, or a browser built on it that reports itself the same way (Brave, Arc). */
export function isChrome() {
  return /Chrome\//.test(navigator.userAgent) && !/Edg\/|OPR\//.test(navigator.userAgent);
}

/** Chrome and Edge's `beforeinstallprompt`, which isn't in TypeScript's DOM types. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Chrome and Edge offer to install the app with this event, once, soon after
// the page loads, so it's kept from module load for an Install button to use
// later. It can show its dialog only once; the browser sends another if the
// user dismisses it.
let installPrompt: BeforeInstallPromptEvent | null = null;
const installPromptListeners = new Set<() => void>();
const setInstallPrompt = (event: BeforeInstallPromptEvent | null) => {
  installPrompt = event;
  installPromptListeners.forEach((listener) => listener());
};
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) =>
    setInstallPrompt(event as BeforeInstallPromptEvent),
  );
  window.addEventListener("appinstalled", () => setInstallPrompt(null));
}

/** Whether the browser can show its own install dialog (`showInstallPrompt`). */
export function canPromptInstall() {
  return installPrompt !== null;
}

/** Calls `listener` when `canPromptInstall` changes. Returns an unsubscribe. */
export function subscribeInstallPrompt(listener: () => void) {
  installPromptListeners.add(listener);
  return () => installPromptListeners.delete(listener);
}

/** Shows the browser's install dialog; installing fires `appinstalled`. */
export async function showInstallPrompt() {
  const event = installPrompt;
  if (!event) return;
  setInstallPrompt(null);
  await event.prompt();
}
