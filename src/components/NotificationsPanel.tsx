"use client";

import { Bell, BellOff, Send } from "lucide-react";
import { unstable_rethrow, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  removePushSubscriptionAction,
  savePushSubscriptionAction,
  sendTestPushAction,
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import type { PushDevice } from "@/core/push";
import { formatRelative } from "@/lib/time";

// What this browser can do about push, worked out once it has loaded.
type Support =
  | { kind: "loading" }
  // iOS only offers push to the app added to the Home Screen.
  | { kind: "needs-install" }
  | { kind: "unsupported" }
  | { kind: "blocked" }
  | { kind: "ready"; endpoint: string | null };

function isIos() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS reports itself as a Mac, but Macs have no touch screen.
    (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1)
  );
}

function isInstalled() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && navigator.standalone === true)
  );
}

/** A name for this device to tell it apart in the list, such as "iPhone" or "Chrome on Mac". */
function deviceLabel() {
  const ua = navigator.userAgent;
  if (/iPhone|iPod/.test(ua)) return "iPhone";
  if (/iPad/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1)) return "iPad";
  const os = /Android/.test(ua)
    ? "Android"
    : /Mac/.test(ua)
      ? "Mac"
      : /Windows/.test(ua)
        ? "Windows"
        : /Linux/.test(ua)
          ? "Linux"
          : null;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : null;
  return [browser, os].filter(Boolean).join(" on ") || "Browser";
}

// The VAPID public key, base64url, as the bytes PushManager.subscribe takes.
function keyBytes(base64url: string) {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

async function readSupport(): Promise<Support> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return isIos() && !isInstalled() ? { kind: "needs-install" } : { kind: "unsupported" };
  }
  if (Notification.permission === "denied") return { kind: "blocked" };
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  return { kind: "ready", endpoint: subscription?.endpoint ?? null };
}

export function NotificationsPanel({
  vapidPublicKey,
  devices,
}: {
  /** null when the server has no VAPID keys, so push is off. */
  vapidPublicKey: string | null;
  devices: PushDevice[];
}) {
  const router = useRouter();
  const [support, setSupport] = useState<Support>({ kind: "loading" });
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    readSupport().then(setSupport, () => setSupport({ kind: "unsupported" }));
  }, []);

  const thisEndpoint = support.kind === "ready" ? support.endpoint : null;
  // Subscribed in this browser and still saved on the server.
  const onHere = thisEndpoint !== null && devices.some((d) => d.endpoint === thisEndpoint);

  // Settings panels report failures inline, where the user is looking.
  function run(label: string, work: () => Promise<void>) {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      try {
        await work();
      } catch (e) {
        // A signed-out session rejects with Next's redirect to /login.
        unstable_rethrow(e);
        setError(`Couldn't ${label}. Please try again.`);
      }
    });
  }

  function turnOn() {
    if (!vapidPublicKey) return;
    run("turn on notifications", async () => {
      // iOS asks only from a tap, which this runs in.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setSupport(permission === "denied" ? { kind: "blocked" } : support);
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(vapidPublicKey),
        }));
      const json = subscription.toJSON();
      await savePushSubscriptionAction({
        endpoint: subscription.endpoint,
        keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
        deviceLabel: deviceLabel(),
      });
      setSupport({ kind: "ready", endpoint: subscription.endpoint });
      router.refresh();
    });
  }

  function remove(endpoint: string) {
    run("turn off notifications", async () => {
      if (endpoint === thisEndpoint) {
        const registration = await navigator.serviceWorker.ready;
        await (await registration.pushManager.getSubscription())?.unsubscribe();
        setSupport({ kind: "ready", endpoint: null });
      }
      await removePushSubscriptionAction(endpoint);
      router.refresh();
    });
  }

  function sendTest() {
    run("send a test notification", async () => {
      const { sent } = await sendTestPushAction();
      toast.success(sent === 1 ? "Sent to 1 device" : `Sent to ${sent} devices`);
      router.refresh();
    });
  }

  return (
    <div
      className="space-y-4 rounded-lg border border-border p-4 aria-disabled:opacity-60"
      aria-disabled={pending || undefined}
    >
      <div className="space-y-1">
        <h2 className="text-sm font-medium">Push notifications</h2>
        <p className="text-sm text-muted-foreground">
          Get a notification on this device when someone else changes something on your
          lists.
        </p>
      </div>

      {!vapidPublicKey ? (
        <p className="text-sm text-muted-foreground">
          Push notifications aren&apos;t set up on this server.
        </p>
      ) : support.kind === "loading" ? null : support.kind === "needs-install" ? (
        <p className="text-sm text-muted-foreground">
          On iPhone and iPad, notifications work in the Sidetrack app. In Safari, tap Share,
          then Add to Home Screen, and open Sidetrack from your Home Screen.
        </p>
      ) : support.kind === "unsupported" ? (
        <p className="text-sm text-muted-foreground">
          This browser can&apos;t show notifications.
        </p>
      ) : support.kind === "blocked" ? (
        <p className="text-sm text-muted-foreground">
          Notifications are blocked for Sidetrack. Allow them in your device&apos;s settings
          (on iPhone, Settings → Notifications → Sidetrack), then come back here.
        </p>
      ) : onHere ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={sendTest}>
            <Send data-icon="inline-start" />
            Send a test
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => thisEndpoint && remove(thisEndpoint)}
          >
            <BellOff data-icon="inline-start" />
            Turn off on this device
          </Button>
        </div>
      ) : (
        <Button type="button" size="sm" onClick={turnOn}>
          <Bell data-icon="inline-start" />
          Turn on for this device
        </Button>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {devices.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground">Devices</h3>
          <ul className="divide-y divide-border rounded-md border border-border">
            {devices.map((device) => (
              <li key={device.endpoint} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">
                    {device.deviceLabel}
                    {device.endpoint === thisEndpoint && (
                      <span className="text-muted-foreground"> · this device</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Added {formatRelative(device.createdAt)}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => remove(device.endpoint)}
                  aria-label={`Remove ${device.deviceLabel}`}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
