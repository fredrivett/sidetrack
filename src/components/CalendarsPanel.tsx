"use client";

import { ArrowUpRight, RefreshCw } from "lucide-react";
import { unstable_rethrow, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  connectICloudAction,
  disconnectCalendarAccountAction,
  setCalendarIncludedAction,
  syncCalendarAccountAction,
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { CalendarAccountView } from "@/core/calendars";
import { formatRelative } from "@/lib/time";
import { cn } from "@/lib/utils";
import { useTapToConfirm } from "./use-tap-to-confirm";

/** The armed look for a destructive button, filled red. */
const ARMED =
  "bg-destructive! text-white! hover:bg-destructive/90! dark:bg-destructive! dark:hover:bg-destructive/90!";

/** The form that signs in to iCloud: a first connect, or signing in again with a new password. */
function ConnectForm({ username: known, onDone }: { username?: string; onDone?: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [username, setUsername] = useState(known ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  function connect() {
    // Enter in a field still submits while it's signing in.
    if (pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await connectICloudAction(username, password);
        if (result.error) {
          setError(result.error);
          return;
        }
        setPassword("");
        onDone?.();
        router.refresh();
      } catch (e) {
        // A signed-out session rejects with Next's redirect to /login.
        unstable_rethrow(e);
        setError("Couldn't connect. Please try again.");
      }
    });
  }

  return (
    <form
      action={connect}
      className={cn("space-y-2", pending && "pointer-events-none opacity-60")}
    >
      {!known && (
        <Input
          name="username"
          type="email"
          value={username}
          readOnly={pending}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Apple ID email"
          aria-label="Apple ID email"
          autoComplete="username"
        />
      )}
      <Input
        name="password"
        type="password"
        value={password}
        readOnly={pending}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="App-specific password (xxxx-xxxx-xxxx-xxxx)"
        aria-label="App-specific password"
        autoComplete="off"
      />
      <Button type="submit" aria-disabled={pending} disabled={!username.trim() || !password.trim()}>
        {pending ? "Signing in…" : known ? "Sign in again" : "Connect iCloud"}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}

function Account({ account }: { account: CalendarAccountView }) {
  const router = useRouter();
  const tap = useTapToConfirm();
  const [pending, startTransition] = useTransition();
  // The calendar being included or left out, which holds until it's saved.
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<void>, calendarId: string | null = null) {
    setError(null);
    setSaving(calendarId);
    startTransition(async () => {
      try {
        await action();
        router.refresh();
      } catch (e) {
        unstable_rethrow(e);
        setError("Couldn't save that. Please try again.");
      } finally {
        setSaving(null);
      }
    });
  }

  return (
    <section
      className={cn("space-y-3 rounded-lg border p-3", pending && saving === null && "opacity-60")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">iCloud · {account.username}</p>
          <p className="text-xs text-muted-foreground">
            {account.lastSyncedAt ? `Synced ${formatRelative(account.lastSyncedAt)}` : "Not synced yet"}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {!account.needsReconnect && (
            <Button
              variant="ghost"
              size="sm"
              aria-disabled={pending}
              onClick={() => !pending && run(() => syncCalendarAccountAction(account.id))}
            >
              <RefreshCw data-icon="inline-start" className={cn(pending && saving === null && "animate-spin")} />
              Sync now
            </Button>
          )}
          <Button
            variant="destructive"
            size="sm"
            aria-disabled={pending}
            onClick={() =>
              !pending && tap.confirm(() => run(() => disconnectCalendarAccountAction(account.id)), "disconnect")
            }
            className={tap.isArmed("disconnect") ? ARMED : undefined}
          >
            {tap.isArmed("disconnect") ? "Confirm?" : "Disconnect"}
          </Button>
        </div>
      </div>

      {account.lastError && <p className="text-sm text-destructive">{account.lastError}</p>}
      {account.needsReconnect && <ConnectForm username={account.username} />}

      {account.calendars.length === 0 ? (
        <p className="text-sm text-muted-foreground">This account has no calendars with events.</p>
      ) : (
        <ul className="divide-y divide-border">
          {account.calendars.map((c) => (
            <li
              key={c.id}
              className={cn("flex items-center gap-3 py-2", saving === c.id && "opacity-60")}
            >
              <Checkbox
                checked={c.included}
                aria-disabled={saving !== null}
                aria-label={`Include ${c.name}`}
                onCheckedChange={(included) =>
                  saving === null && run(() => setCalendarIncludedAction(c.id, included), c.id)
                }
              />
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: c.color ?? "var(--muted-foreground)" }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-sm">{c.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {c.included ? `${c.events} upcoming` : "Left out"}
              </span>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </section>
  );
}

export function CalendarsPanel({ accounts }: { accounts: CalendarAccountView[] }) {
  return (
    <div className="space-y-6">
      {accounts.map((a) => (
        <Account key={a.id} account={a} />
      ))}

      <section className="space-y-3">
        <h2 className="text-sm font-medium">{accounts.length ? "Connect another iCloud account" : "Connect iCloud"}</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>
            Go to{" "}
            <a
              href="https://account.apple.com/account/manage"
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-0.5 underline-offset-2 hover:underline"
            >
              account.apple.com
              <ArrowUpRight className="size-3.5" />
            </a>{" "}
            → Sign-In and Security → App-Specific Passwords, and make one called
            &ldquo;Sidetrack&rdquo;.
          </li>
          <li>Enter your Apple ID and that password below.</li>
        </ol>
        <p className="text-xs text-muted-foreground">
          Sidetrack only reads your calendars, and keeps the password encrypted. An
          app-specific password can reach your iCloud mail and contacts too, so revoke it
          at account.apple.com whenever you like; Sidetrack stops at once.
        </p>
        <ConnectForm />
      </section>
    </div>
  );
}
