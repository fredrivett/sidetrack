"use client";

import { Check, ChevronDown, Share2 } from "lucide-react";
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
import { encode } from "uqr";
import {
  recordInstallAction,
  sendGetStartedToBackAction,
  setGetStartedCollapsedAction,
} from "@/app/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { InstallPlatform } from "@/core/events";
import { GET_STARTED_STEPS, type GetStarted, type GetStartedStep } from "@/lib/getStarted";
import { installPlatform, isInstalled, isSafari } from "@/lib/device";
import { runAction } from "./run-action";

const TITLES: Record<GetStartedStep, string> = {
  lists: "Set up your lists",
  iphone: "Put Sidetrack on your iPhone",
  mac: "Add Sidetrack to your Dock",
  share: "Share a list with someone",
  agent: "Let an agent work on your lists",
};

/** The install step each platform ticks. */
const INSTALL_STEP: Record<InstallPlatform, GetStartedStep> = { ios: "iphone", macos: "mac" };

/** This device, once the browser has said; null while rendering on the server. */
interface Device {
  platform: InstallPlatform | null;
  safari: boolean;
}

const noSubscribe = () => () => {};

function useDevice(): Device | null {
  // A string snapshot, so it's stable between renders; "" on the server.
  const key = useSyncExternalStore(
    noSubscribe,
    () => `${installPlatform() ?? ""}|${isSafari() ? "safari" : ""}`,
    () => "",
  );
  if (!key) return null;
  const [platform, safari] = key.split("|");
  return { platform: (platform || null) as InstallPlatform | null, safari: safari === "safari" };
}

/**
 * Tells the server when the app is open in its own window on an iPhone, iPad
 * or Mac, which ticks that install step. A background sync: silent, and only
 * sent while the step isn't done.
 */
export function InstallReporter({ done }: { done: GetStarted["done"] }) {
  useEffect(() => {
    const platform = installPlatform();
    if (!platform || done[INSTALL_STEP[platform]] || !isInstalled()) return;
    recordInstallAction(platform).catch((error) => {
      unstable_rethrow(error);
      // Silent: it's sent again on the next launch.
    });
  }, [done]);
  return null;
}

/** A QR code for `text`, drawn as SVG modules. */
function QrCode({ text }: { text: string }) {
  const { data, size } = encode(text, { border: 1 });
  const path = data
    .flatMap((row, y) => row.map((on, x) => (on ? `M${x} ${y}h1v1h-1z` : "")))
    .join("");
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`QR code for ${text}`}
      className="size-28 rounded-md bg-white p-1"
      shapeRendering="crispEdges"
    >
      <path d={path} fill="#0a0a0a" />
    </svg>
  );
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
}: {
  state: GetStarted;
  /** The lists the viewer owns, which they can share. */
  shareable: { id: string; name: string }[];
  onShare: (projectId: string, projectName: string) => void;
  onAddList: () => void;
}) {
  const device = useDevice();
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
  const doneCount = GET_STARTED_STEPS.filter(done).length;
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
  const installed = (platform: InstallPlatform) =>
    start(async () => {
      setShowCode(false);
      showQueue({ step: INSTALL_STEP[platform], to: "done" });
      posthog.capture("get_started_done", { step: INSTALL_STEP[platform], how: "button" });
      await runAction(recordInstallAction(platform), "save that");
    });

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
      case "iphone":
        if (device?.platform === "ios") {
          why = (
            <>
              So it&apos;s a tap away, and can nudge you when something&apos;s due. In Safari, tap
              Share, then Add to Home Screen, and open Sidetrack from there. Then turn on
              notifications in{" "}
              <Link href="/settings/notifications" className="underline underline-offset-2">
                Settings
              </Link>
              .
            </>
          );
        } else {
          why = showCode
            ? "Scan this with your iPhone's camera. In Safari, tap Share, then Add to Home Screen, and open Sidetrack from there."
            : "So it's a tap away, and can nudge you when something's due.";
        }
        actions =
          device?.platform !== "ios" && !showCode ? (
            <Button size="sm" onClick={() => setShowCode(true)}>
              Show code
            </Button>
          ) : (
            <Button size="sm" onClick={() => installed("ios")}>
              I&apos;ve done it
            </Button>
          );
        break;
      case "mac":
        why =
          device?.platform === "macos"
            ? device.safari
              ? "It opens in its own window, one click away. In Safari's menu bar, choose File → Add to Dock."
              : "It opens in its own window, one click away. Choose Install in the address bar or the browser's menu, or use Safari's File → Add to Dock."
            : "Next time you're on your Mac, open Sidetrack in Safari and choose File → Add to Dock.";
        actions = (
          <Button size="sm" onClick={() => installed("macos")}>
            I&apos;ve done it
          </Button>
        );
        break;
      case "share":
        why = "A household list, or a project with a friend. Their changes show up on your board as they make them.";
        actions =
          shareable.length === 0 ? (
            <span className="text-xs text-muted-foreground">Make a list first.</span>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button size="sm" />}>
                <Share2 data-icon="inline-start" />
                Share a list
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {shareable.map((list) => (
                  <DropdownMenuItem key={list.id} onClick={() => onShare(list.id, list.name)}>
                    {list.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
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
      <div className="relative z-10 rounded-xl border border-border bg-background p-3 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">{TITLES[step]}</h3>
          {optional && (
            <span className="rounded border border-border px-1.5 text-[11px] text-muted-foreground">
              Optional
            </span>
          )}
        </div>
        <p className="mt-0.5 text-sm text-pretty text-muted-foreground">{why}</p>
        {step === "iphone" && showCode && device?.platform !== "ios" && (
          <div className="mt-3">
            <QrCode text={window.location.origin} />
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
              style={{ width: `${(doneCount / GET_STARTED_STEPS.length) * 100}%` }}
            />
          </span>
          <span className="tabular-nums text-neutral-400 dark:text-neutral-500">
            {doneCount} of {GET_STARTED_STEPS.length}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={`ml-auto size-3.5 transition-transform duration-300 ease-out motion-reduce:transition-none ${
              collapsed ? "" : "rotate-180"
            }`}
          />
        </button>
      </h2>
      {!collapsed && (
        <div id={bodyId} className="mt-1 space-y-2">
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
            {GET_STARTED_STEPS.map((step) =>
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
        </div>
      )}
    </section>
  );
}
