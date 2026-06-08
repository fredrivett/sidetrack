"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient, signIn, signUp } from "@/auth/client";
import { sanitizeNext } from "@/lib/safe-next";
import { USERNAME_MAX, USERNAME_MIN, validateUsername } from "@/lib/username";

type Mode = "sign-in" | "sign-up";

type UsernameStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available" }
  | { kind: "taken" }
  | { kind: "invalid"; message: string };

export function LoginForm({
  allowSignUp,
  next,
}: {
  allowSignUp: boolean;
  next: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  // Async availability result, tagged with the handle it was checked for so a
  // stale result is never shown against newer input.
  const [avail, setAvail] = useState<{ handle: string; ok: boolean } | null>(
    null,
  );

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
      setAvail(
        res.error ? null : { handle: username, ok: !!res.data?.available },
      );
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
    usernameStatus = avail.ok ? { kind: "available" } : { kind: "taken" };
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
          name: name || email,
          username,
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
      }
      // Re-sanitize at the navigation site: never trust the prop blindly,
      // so an open-redirect target can't slip through if the caller changes.
      router.push(sanitizeNext(next));
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  const usernameBlocksSubmit =
    mode === "sign-up" &&
    (usernameStatus.kind === "taken" ||
      usernameStatus.kind === "invalid" ||
      usernameStatus.kind === "checking" ||
      username === "");

  return (
    <form action={onSubmit} className="space-y-3">
      {allowSignUp && (
        <div className="flex gap-1 rounded-lg bg-muted p-1 text-sm">
          <button
            type="button"
            onClick={() => setMode("sign-in")}
            className={`flex-1 rounded-md py-1 ${
              mode === "sign-in" ? "bg-background shadow-sm" : "text-muted-foreground"
            }`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => setMode("sign-up")}
            className={`flex-1 rounded-md py-1 ${
              mode === "sign-up" ? "bg-background shadow-sm" : "text-muted-foreground"
            }`}
          >
            Sign up
          </button>
        </div>
      )}
      {mode === "sign-up" && (
        <Input name="name" autoComplete="name" placeholder="Name (optional)" />
      )}
      {mode === "sign-up" && (
        <div className="space-y-1">
          <Input
            name="username"
            autoComplete="username"
            placeholder="Username"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            minLength={USERNAME_MIN}
            maxLength={USERNAME_MAX}
            aria-invalid={
              usernameStatus.kind === "taken" ||
              usernameStatus.kind === "invalid"
            }
          />
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
        </div>
      )}
      <Input
        name="email"
        type="email"
        autoComplete="email"
        placeholder="Email"
        required
        autoFocus
      />
      <Input
        name="password"
        type="password"
        autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
        placeholder="Password"
        required
        minLength={8}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button
        type="submit"
        disabled={pending || usernameBlocksSubmit}
        className="w-full"
      >
        {pending ? "…" : mode === "sign-up" ? "Create account" : "Sign in"}
      </Button>
    </form>
  );
}
