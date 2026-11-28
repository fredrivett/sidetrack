"use client";

import { type ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, LogIn, UserPlus } from "lucide-react";
import { AuthShell, AuthTitle } from "@/components/AuthShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingEllipsis } from "@/components/ui/loading-ellipsis";
import { authClient, signIn, signUp } from "@/auth/client";
import { sanitizeNext } from "@/lib/safe-next";
import { USERNAME_MAX, USERNAME_MIN, validateUsername } from "@/lib/username";

export type Mode = "sign-in" | "sign-up";

type UsernameStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available" }
  | { kind: "taken" }
  | { kind: "invalid"; message: string }
  // The availability request itself failed (network/server). Non-blocking:
  // the server re-validates uniqueness on submit, so let the user proceed.
  | { kind: "error" };

export function LoginForm({
  allowSignUp,
  initialMode,
  next,
  signUpAbove,
  invite,
}: {
  allowSignUp: boolean;
  initialMode: Mode;
  next: string;
  /** Shown above the card while signing up: the founding ticket. */
  signUpAbove?: ReactNode;
  /**
   * Signing up from an invite's link (/invite/[token]): the sign-up carries
   * its token, which lets them in on a closed instance and accepts it, and
   * starts with the address it was sent to. `above` shows what it's for,
   * whichever way they sign in.
   */
  invite?: { token: string; email: string; above: ReactNode };
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  // Async availability result, tagged with the handle it was checked for so a
  // stale result is never shown against newer input. `result` captures the
  // errored case explicitly so it's distinguishable from "still in flight"
  // (a missing result for the current handle) — otherwise a failed check
  // would look like a perpetual "checking" and block submit forever.
  const [avail, setAvail] = useState<{
    handle: string;
    result: "available" | "taken" | "error";
  } | null>(null);

  const formatError =
    mode === "sign-up" && username !== "" ? validateUsername(username) : null;

  // Debounced availability check while signing up. Only the async callback
  // sets state; the synchronous status is derived during render below.
  useEffect(() => {
    if (mode !== "sign-up" || username === "" || validateUsername(username))
      return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const res = await authClient.isUsernameAvailable({ username });
      if (cancelled) return;
      setAvail({
        handle: username,
        result: res.error
          ? "error"
          : res.data?.available
            ? "available"
            : "taken",
      });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [username, mode]);

  let usernameStatus: UsernameStatus;
  if (mode !== "sign-up" || username === "") usernameStatus = { kind: "idle" };
  else if (formatError)
    usernameStatus = { kind: "invalid", message: formatError };
  else if (avail && avail.handle === username)
    usernameStatus = { kind: avail.result };
  else usernameStatus = { kind: "checking" };

  async function onSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const name = String(formData.get("name") ?? "").trim();

    try {
      if (mode === "sign-up") {
        const res = await signUp.email({
          email,
          password,
          name,
          username,
          ...(invite && { invite: invite.token }),
        });
        if (res.error) {
          setError(res.error.message ?? "Sign up failed.");
          return;
        }
      } else {
        const res = await signIn.email({ email, password });
        if (res.error) {
          setError(res.error.message ?? "Sign in failed.");
          return;
        }
        // The password was right, but the account asks for a second step:
        // no session yet, only the short-lived two-factor cookie.
        if (res.data && "twoFactorRedirect" in res.data && res.data.twoFactorRedirect) {
          router.push(`/login/two-factor?next=${encodeURIComponent(sanitizeNext(next))}`);
          return;
        }
      }
      // Re-sanitize at the navigation site: never trust the prop blindly,
      // so an open-redirect target can't slip through if the caller changes.
      router.push(sanitizeNext(next));
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  // Only a handle shown as taken or invalid holds the button back, where the
  // note under it says why. One still being checked can be sent: the server
  // checks it again, and an empty one is caught by the field's `required`.
  const usernameBlocksSubmit =
    mode === "sign-up" &&
    (usernameStatus.kind === "taken" || usernameStatus.kind === "invalid");

  const switchMode = (to: Mode) => {
    setMode(to);
    setError(null);
  };

  return (
    <AuthShell above={invite?.above ?? (mode === "sign-up" && signUpAbove)}>
      <AuthTitle title={mode === "sign-up" ? (invite ? "Join Sidetrack" : "Create your account") : "Welcome back"}>
        {mode === "sign-up"
          ? invite
            ? "Create your account to accept."
            : "Get your side projects back on track."
          : invite
            ? "Sign in to accept."
            : "Sign in to your board."}
      </AuthTitle>
      <form action={onSubmit} className="space-y-4">
        {mode === "sign-up" && (
          <Field id="name" label="Name">
            {/* The first field, so typing starts there. */}
            <Input id="name" name="name" autoComplete="name" required autoFocus className="h-9" />
          </Field>
        )}
        {mode === "sign-up" && (
          <Field
            id="username"
            label="Username"
            note={
              <>
                {usernameStatus.kind === "checking" && (
                  <p className="text-xs text-muted-foreground">Checking…</p>
                )}
                {usernameStatus.kind === "available" && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-500">
                    {username} is available.
                  </p>
                )}
                {usernameStatus.kind === "taken" && (
                  <p className="text-xs text-destructive">
                    {username} is taken.
                  </p>
                )}
                {usernameStatus.kind === "invalid" && (
                  <p className="text-xs text-destructive">{usernameStatus.message}</p>
                )}
                {usernameStatus.kind === "error" && (
                  <p className="text-xs text-muted-foreground">
                    Couldn&apos;t check availability — you can still try.
                  </p>
                )}
              </>
            }
          >
            <Input
              id="username"
              name="username"
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              minLength={USERNAME_MIN}
              maxLength={USERNAME_MAX}
              className="h-9"
              aria-invalid={
                usernameStatus.kind === "taken" ||
                usernameStatus.kind === "invalid"
              }
            />
          </Field>
        )}
        <Field id="email" label="Email">
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            defaultValue={invite?.email}
            required
            autoFocus={mode === "sign-in"}
            className="h-9"
          />
        </Field>
        <Field
          id="password"
          label="Password"
          hint={
            mode === "sign-in" ? (
              <Link
                href="/forgot-password"
                className="hover:text-foreground hover:underline"
              >
                Forgot password?
              </Link>
            ) : (
              "At least 8 characters"
            )
          }
        >
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
            required
            minLength={8}
            className="h-9"
          />
        </Field>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button
          type="submit"
          size="lg"
          disabled={pending || usernameBlocksSubmit}
          className="w-full"
        >
          {pending ? (
            <>
              <Loader2 className="animate-spin" />
              <span>
                {mode === "sign-up" ? "Creating account" : "Signing in"}
                <LoadingEllipsis />
              </span>
            </>
          ) : mode === "sign-up" ? (
            <>
              <UserPlus data-icon="inline-start" />
              Create account
            </>
          ) : (
            <>
              <LogIn data-icon="inline-start" />
              Sign in
            </>
          )}
        </Button>
      </form>
      {allowSignUp && (
        <p className="border-t border-neutral-200 pt-4 text-center text-sm text-muted-foreground dark:border-neutral-800">
          {mode === "sign-up" ? "Already have an account?" : "New to Sidetrack?"}{" "}
          <button
            type="button"
            onClick={() => switchMode(mode === "sign-up" ? "sign-in" : "sign-up")}
            disabled={pending}
            className="font-medium text-foreground hover:underline disabled:pointer-events-none disabled:opacity-50"
          >
            {mode === "sign-up" ? "Sign in" : "Create an account"}
          </button>
        </p>
      )}
    </AuthShell>
  );
}

/**
 * A labelled input (give it `id`), with an optional hint or link on the label's right and a
 * note, such as the username's availability, under the input.
 */
function Field({
  id,
  label,
  hint,
  note,
  children,
}: {
  /** The input's id, which the label points at. */
  id: string;
  label: string;
  hint?: ReactNode;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      {/* The hint stays outside the label: a link inside one would be part
          of the input's label and its click target. */}
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
      {note}
    </div>
  );
}
