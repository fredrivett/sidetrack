"use client";

import { Bell, Check, ChevronDown, House, Plus, ShieldCheck } from "lucide-react";
import Link from "next/link";
import posthog from "posthog-js";
import { unstable_rethrow } from "next/navigation";
import {
  useEffect,
  useId,
  useOptimistic,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import {
  recordInstallAction,
  sendGetStartedToBackAction,
  setGetStartedCollapsedAction,
} from "@/app/actions";
import { QrCode } from "@/components/QrCode";
import { Button, buttonVariants } from "@/components/ui/button";
import { Fold } from "@/components/ui/fold";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  type GetStarted,
  type GetStartedStep,
  type InstallPlatform,
} from "@/lib/getStarted";
import {
  canPromptInstall,
  installPlatform,
  isAndroid,
  isChrome,
  isEdge,
  isFirefox,
  isInstalled,
  isIos,
  isSafari,
  showInstallPrompt,
  subscribeInstallPrompt,
} from "@/lib/device";
import { runAction } from "./run-action";

const TITLES: Record<GetStartedStep, string> = {
  lists: "Set up your lists",
  date: "Give something a date",
  repeat: "Make something repeat",
  label: "Create your first label",
  notifications: "Turn on notifications",
  secure: "Secure your account",
  phone: "Add Sidetrack to your Home Screen",
  computer: "Install Sidetrack on your computer",
  share: "Share with someone",
  agent: "Let an agent work on your lists",
};

/** This device, once the browser has said; null while rendering on the server. */
interface Device {
  platform: InstallPlatform;
  os: "ios" | "android" | "mac" | "windows" | "other";
  browser: "safari" | "firefox" | "edge" | "chrome" | "other";
}

const noSubscribe = () => () => {};

function useDevice(): Device | null {
  // A string snapshot, so it's stable between renders; "" on the server.
  const key = useSyncExternalStore(
    noSubscribe,
    () =>
      [
        installPlatform(),
        isIos()
          ? "ios"
          : isAndroid()
            ? "android"
            : /Macintosh/.test(navigator.userAgent)
              ? "mac"
              : /Windows/.test(navigator.userAgent)
                ? "windows"
                : "other",
        isSafari()
          ? "safari"
          : isFirefox()
            ? "firefox"
            : isEdge()
              ? "edge"
              : isChrome()
                ? "chrome"
                : "other",
      ].join("|"),
    () => "",
  );
  if (!key) return null;
  const [platform, os, browser] = key.split("|");
  return { platform, os, browser } as Device;
}

/**
 * Tells the server when the app is installed on a phone or a computer, which
 * ticks that install step: when it's open in its own window, and in Chrome
 * and Edge the moment Install is chosen (`appinstalled`). Nobody reports it
 * by hand. A background sync: silent, and only sent while the step isn't
 * done. The change reaches the user's other open boards, so scanning the
 * code and opening the app on a phone ticks the card on the computer.
 */
export function InstallReporter({ done }: { done: GetStarted["done"] }) {
  useEffect(() => {
    const platform = installPlatform();
    if (done[platform]) return;
    const report = (how: "opened" | "appinstalled") => {
      posthog.capture("get_started_done", { step: platform, how });
      recordInstallAction(platform).catch((error) => {
        unstable_rethrow(error);
        // Silent: it's sent again on the next launch.
      });
    };
    if (isInstalled()) {
      report("opened");
      return;
    }
    const onInstalled = () => report("appinstalled");
    window.addEventListener("appinstalled", onInstalled);
    return () => window.removeEventListener("appinstalled", onInstalled);
  }, [done]);
  return null;
}

/** "@a", "@a and @b", "@a, @b and 2 others". */
function listPeople(handles: string[]): string {
  if (handles.length <= 2) return handles.join(" and ");
  const rest = handles.length - 2;
  return `${handles.slice(0, 2).join(", ")} and ${rest === 1 ? handles[2] : `${rest} others`}`;
}

/**
 * The Agenda's Get started stack: one card at a time for the next step,
 * the next two peeking out behind it, and every step listed underneath,
 * done ones ticked. Steps tick themselves off from what the user does
 * (core/getStarted.ts); Later sends a card to the back. It folds to its
 * progress bar and never goes away.
 */
export function GetStartedStack({
  state,
  shareable,
  onShare,
  onAddList,
  onAddItem,
}: {
  state: GetStarted;
  /** The lists the viewer owns, which they can share. */
  shareable: { id: string; name: string }[];
  onShare: (projectId: string, projectName: string) => void;
  onAddList: () => void;
  /** Opens New item, due today when `dueToday`. */
  onAddItem: (dueToday: boolean) => void;
}) {
  const device = useDevice();
  // Chrome and Edge can show their own install dialog from a button.
  const canInstall = useSyncExternalStore(subscribeInstallPrompt, canPromptInstall, () => false);
  const [, start] = useTransition();
  const bodyId = useId();
  // Folds, sends back and ticks at once, then saves; a failed save puts it
  // back with a toast.
  const [collapsed, showCollapsed] = useOptimistic(state.collapsed);
  const [queue, showQueue] = useOptimistic(
    state.queue,
    (q: GetStartedStep[], { step, to }: { step: GetStartedStep; to: "back" | "done" }) => {
      const rest = q.filter((s) => s !== step);
      return to === "back" ? [...rest, step] : rest;
    },
  );
  // A step tapped in the list comes to the front, on this page only.
  const [picked, setPicked] = useState<GetStartedStep | null>(null);
  const [showCode, setShowCode] = useState(false);

  const done = (step: GetStartedStep) => !queue.includes(step);
  const doneCount = state.steps.filter(done).length;
  const front = picked && queue.includes(picked) ? picked : queue[0];
  const order = front ? [front, ...queue.filter((s) => s !== front)] : [];

  const toggle = () =>
    start(async () => {
      const next = !collapsed;
      showCollapsed(next);
      await runAction(
        setGetStartedCollapsedAction(next),
        next ? "collapse Get started" : "expand Get started",
      );
    });
  const later = (step: GetStartedStep) =>
    start(async () => {
      setPicked(null);
      setShowCode(false);
      showQueue({ step, to: "back" });
      posthog.capture("get_started_later", { step });
      await runAction(sendGetStartedToBackAction(step), "move that card");
    });

  // The install cards have no button to tick them: the installed app reports
  // itself (InstallReporter), so they say so instead.
  const ticksItself = (
    <span className="text-xs text-muted-foreground">Ticks itself once it&apos;s installed</span>
  );

  const card = (step: GetStartedStep) => {
    const optional = step === "agent";
    const laterButton = (
      <Button size="sm" variant="ghost" onClick={() => later(step)}>
        {optional ? "Not now" : "Later"}
      </Button>
    );
    let why: React.ReactNode;
    let actions: React.ReactNode;
    switch (step) {
      case "lists":
        why = "Make a list for each thing you're juggling: home, work, a side project.";
        actions = (
          <Button size="sm" onClick={onAddList}>
            Add a list
          </Button>
        );
        break;
      case "date":
        why = "Dated things come to you: they show up here on your Brief on the day they're due, so you don't have to go looking.";
        actions = (
          <Button size="sm" onClick={() => onAddItem(true)}>
            <Plus data-icon="inline-start" />
            Add something for today
          </Button>
        );
        break;
      case "repeat":
        why = "For the things that come round again, like bins night or paying the rent. Pick Repeat when you add or edit an item, and once you tick it off it comes back when it's next due.";
        actions = (
          <Button size="sm" onClick={() => onAddItem(false)}>
            <Plus data-icon="inline-start" />
            Add a repeating item
          </Button>
        );
        break;
      case "label":
        why = "Labels group items across a list, like errands, calls or waiting on, and Filter shows just the ones with a label. Pick Label when you add or edit an item.";
        actions = (
          <Button size="sm" onClick={() => onAddItem(false)}>
            <Plus data-icon="inline-start" />
            Add an item
          </Button>
        );
        break;
      case "notifications":
        why =
          device?.os === "ios" && !isInstalled()
            ? "So Sidetrack can nudge you when something's due or someone gives you something to do. On an iPhone, add Sidetrack to your Home Screen first, then turn them on from there."
            : "So Sidetrack can nudge you when something's due or someone gives you something to do. Turn them on for each phone and computer you use.";
        actions = (
          <Link href="/settings/notifications" className={buttonVariants({ size: "sm" })}>
            <Bell data-icon="inline-start" />
            Turn on notifications
          </Link>
        );
        break;
      case "secure":
        why = "Turn on two-factor sign-in, so signing in also asks for a code from an authenticator app. Your password alone won't get anyone in.";
        actions = (
          <Link href="/settings/profile?setup=two-factor" className={buttonVariants({ size: "sm" })}>
            <ShieldCheck data-icon="inline-start" />
            Set up two-factor
          </Link>
        );
        break;
      case "phone": {
        if (device?.os === "ios") {
          why = (
            <>
              So it&apos;s a tap away, and can nudge you when something&apos;s due. In Safari, tap
              Share, then Add to Home Screen, and open Sidetrack from there.
            </>
          );
        } else if (device?.os === "android") {
          why = (
            <>
              So it&apos;s a tap away, and can nudge you when something&apos;s due. In Chrome, tap
              ⋮, then Add to Home screen or Install app, and open Sidetrack from there.
            </>
          );
        } else {
          why = showCode
            ? "Scan this with your phone's camera. On an iPhone, tap Share in Safari, then Add to Home Screen. On Android, tap ⋮ in Chrome, then Add to Home screen."
            : "So it's a tap away on your phone, and can nudge you when something's due.";
        }
        actions =
          device?.platform === "computer" && !showCode ? (
            <Button size="sm" onClick={() => setShowCode(true)}>
              Show code
            </Button>
          ) : (
            ticksItself
          );
        break;
      }
      case "computer": {
        const opensFrom =
          device?.os === "mac"
            ? " It then opens from your Dock, like any other app."
            : device?.os === "windows"
              ? " It then opens from the Start menu or your taskbar, like any other app."
              : "";
        why =
          device?.platform === "phone" || !device
            ? "Next time you're at your computer, open Sidetrack in Chrome or Edge and choose Install, or in Safari on a Mac choose File → Add to Dock."
            : canInstall
              ? `It opens in its own window, one click away.${opensFrom}`
              : device.browser === "safari"
                ? "It opens in its own window, one click away. In Safari's menu bar, choose File → Add to Dock, then open Sidetrack from your Dock."
                : device.browser === "firefox"
                  ? `Firefox can't install web apps. Open Sidetrack in Chrome or Edge and choose Install${device.os === "mac" ? ", or in Safari choose File → Add to Dock" : ""}.`
                  : device.browser === "edge"
                    ? `It opens in its own window, one click away. Click the Install icon at the right of the address bar, or open the … menu, then Apps → Install Sidetrack.${opensFrom}`
                    : device.browser === "chrome"
                      ? `It opens in its own window, one click away. Click the Install icon at the right of the address bar, or open the ⋮ menu, then Cast, save and share → Install Sidetrack.${opensFrom}`
                      : `It opens in its own window, one click away. Choose Install in the address bar, or Install Sidetrack in the browser's menu.${opensFrom}`;
        actions =
          device?.platform === "computer" && canInstall ? (
            <Button
              size="sm"
              onClick={() => {
                posthog.capture("get_started_install_prompt");
                void showInstallPrompt();
              }}
            >
              Install Sidetrack
            </Button>
          ) : (
            ticksItself
          );
        break;
      }
      case "share":
        why =
          state.pendingInvites.length > 0 ? (
            <>
              Waiting for {listPeople(state.pendingInvites)} to accept. Ticks itself once they do,
              or share with someone else meanwhile.
            </>
          ) : (
            "Make a Space for your household or a project with a friend, and everyone in it sees every list in it. Their changes show up on your board as they make them."
          );
        actions = (
          <>
            <Link href="/settings/spaces" className={buttonVariants({ size: "sm" })}>
              <House data-icon="inline-start" />
              Make a Space
            </Link>
            {shareable.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button size="sm" variant="outline" />}>
                  Share one list
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {shareable.map((list) => (
                    <DropdownMenuItem key={list.id} onClick={() => onShare(list.id, list.name)}>
                      {list.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        );
        break;
      case "agent":
        why = "Connect Claude, Amp or another MCP agent, and it can add items, pick them up and tick them off.";
        actions = (
          <Link href="/settings/keys" className={buttonVariants({ size: "sm" })}>
            Connect an agent
          </Link>
        );
        break;
    }
    return (
      <div className="relative z-10 flex flex-col gap-3 rounded-xl border border-border bg-background p-3 shadow-sm sm:flex-row sm:gap-4">
        {/* Charcoal on white paper for light mode, chalk on black for dark: each
            blends its paper into the card. Lazy, so the hidden one isn't fetched
            until it's shown. Keyed by step so a new step never shows the last
            step's drawing while its own loads. */}
        <div key={step} aria-hidden="true" className="aspect-[4/3] w-48 shrink-0 self-start sm:w-44">
          {/* eslint-disable-next-line @next/next/no-img-element -- small static WebP, no resizing needed */}
          <img
            src={`/get-started/${step}-light.webp`}
            alt=""
            loading="lazy"
            className="size-full rounded-lg mix-blend-multiply dark:hidden"
          />
          {/* eslint-disable-next-line @next/next/no-img-element -- as above */}
          <img
            src={`/get-started/${step}-dark.webp`}
            alt=""
            loading="lazy"
            className="hidden size-full rounded-lg mix-blend-screen dark:block"
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">{TITLES[step]}</h3>
            {optional && (
              <span className="rounded border border-border px-1.5 text-[11px] text-muted-foreground">
                Optional
              </span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-pretty text-muted-foreground">{why}</p>
          {step === "phone" && showCode && device?.platform === "computer" && (
            <div className="mt-3">
              <QrCode text={window.location.origin} label={`QR code for ${window.location.origin}`} />
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {actions}
            {laterButton}
            <span className="ml-auto text-xs text-muted-foreground">
              {order.length > 1 ? `${order.length - 1} more` : "Last one"}
            </span>
          </div>
        </div>
      </div>
    );
  };

  const behind = Math.min(order.length - 1, 2);
  return (
    <section aria-label="Get started" className="pb-2">
      <h2 className="text-xs font-medium">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-neutral-700 outline-none hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-neutral-300 dark:text-neutral-300 dark:hover:text-neutral-100 dark:focus-visible:ring-neutral-600"
        >
          Get started
          <span className="h-1 w-24 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <span
              className="block h-full rounded-full bg-neutral-700 transition-[width] duration-300 ease-out dark:bg-neutral-300"
              style={{ width: `${(doneCount / state.steps.length) * 100}%` }}
            />
          </span>
          <span className="tabular-nums text-neutral-400 dark:text-neutral-500">
            {doneCount} of {state.steps.length}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={`ml-auto size-3.5 transition-transform duration-300 ease-out motion-reduce:transition-none ${
              collapsed ? "" : "rotate-180"
            }`}
          />
        </button>
      </h2>
      <Fold id={bodyId} open={!collapsed} className="space-y-2 pt-1">
        {front ? (
          // The cards behind peek out below the front one.
          <div className="relative" style={{ paddingBottom: behind * 6 }}>
            {Array.from({ length: behind }, (_, i) => (
              <div
                key={i}
                aria-hidden="true"
                className="absolute inset-x-0 top-0 rounded-xl border border-border bg-muted/40"
                style={{
                  bottom: behind * 6,
                  transform: `translateY(${(i + 1) * 6}px) scale(${1 - (i + 1) * 0.03})`,
                  zIndex: 5 - i,
                }}
              />
            ))}
            {card(front)}
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-background p-3">
            <h3 className="text-sm font-medium">You&apos;re all set</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Everything&apos;s in place. This stays here, folded, if you want it again.
            </p>
          </div>
        )}
        <ul className="space-y-0.5 text-sm">
          {state.steps.map((step) =>
            done(step) ? (
              <li key={step} className="flex items-center gap-2 px-1 py-0.5 text-muted-foreground">
                <Check aria-hidden="true" className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                <span className="flex-1">{TITLES[step]}</span>
                <span className="text-xs">Done</span>
              </li>
            ) : (
              <li key={step}>
                <button
                  type="button"
                  onClick={() => {
                    setPicked(step);
                    setShowCode(false);
                  }}
                  aria-current={step === front ? "step" : undefined}
                  className="flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-neutral-300 aria-[current=step]:bg-muted dark:focus-visible:ring-neutral-600"
                >
                  <span aria-hidden="true" className="size-3.5 rounded-[4px] border border-neutral-400" />
                  <span className="flex-1">{TITLES[step]}</span>
                  {step === "agent" && <span className="text-xs text-muted-foreground">Optional</span>}
                </button>
              </li>
            ),
          )}
        </ul>
      </Fold>
    </section>
  );
}
