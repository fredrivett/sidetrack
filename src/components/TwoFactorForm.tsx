"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck } from "lucide-react";
import { AuthTitle } from "@/components/AuthShell";
import { CodeInput } from "@/components/CodeInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingEllipsis } from "@/components/ui/loading-ellipsis";
import { twoFactor } from "@/auth/client";
import { sanitizeNext } from "@/lib/safe-next";

type Method = "totp" | "backup";

/** A backup code as typed: spaces dropped, and the dash put back if left out
 * (codes are shown as `abcde-12345`). Case is kept: codes are mixed case. */
function normalizeBackupCode(raw: string): string {
  const code = raw.replace(/\s+/g, "");
  return /^[A-Za-z0-9]{10}$/.test(code) ? `${code.slice(0, 5)}-${code.slice(5)}` : code;
}

/**
 * The second step of signing in, after a right password on an account with
 * two-factor sign-in: a code from the authenticator app, or a backup code.
 * Better Auth holds the half-signed-in state in a 10-minute cookie; once it
 * lapses, the only way on is the password again.
 */
export function TwoFactorForm({ next }: { next: string }) {
  const router = useRouter();
  const [method, setMethod] = useState<Method>("totp");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ message: string; expired?: boolean } | null>(null);
  // The authenticator code, held here so it can be checked as soon as the
  // sixth digit lands, and cleared after a wrong one.
  const [totp, setTotp] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const totpRef = useRef<HTMLInputElement>(null);

  async function verify(code: string) {
    if (pending) return;
    const trustDevice = new FormData(formRef.current ?? undefined).get("trust") === "on";
    setPending(true);
    setError(null);
    try {
      const res =
        method === "totp"
          ? await twoFactor.verifyTotp({ code, trustDevice })
          : await twoFactor.verifyBackupCode({ code: normalizeBackupCode(code), trustDevice });
      if (res.error) {
        if (res.error.status === 429) {
          setError({ message: "Too many attempts. Wait a few seconds and try again." });
        } else if (res.error.code === "INVALID_TWO_FACTOR_COOKIE") {
          setError({ message: "This sign-in has timed out.", expired: true });
        } else {
          setError({
            message:
              method === "totp"
                ? "That code didn't work. Check your authenticator app and try again."
                : "That backup code didn't work. Each one works only once.",
          });
        }
        setPending(false);
        if (method === "totp") {
          setTotp("");
          totpRef.current?.focus();
        }
        return;
      }
      router.push(sanitizeNext(next));
      router.refresh();
    } catch {
      setError({ message: "Couldn't check the code. Please try again." });
      setPending(false);
    }
  }

  // onSubmit, not a form action: an action resets the fields on a failed
  // attempt, so a one-character typo would wipe a backup code.
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void verify(method === "totp" ? totp : String(new FormData(event.currentTarget).get("code") ?? ""));
  }

  const switchMethod = () => {
    setMethod(method === "totp" ? "backup" : "totp");
    setTotp("");
    setError(null);
  };

  return (
    <>
      <AuthTitle title="Two-factor sign-in">
        {method === "totp"
          ? "Enter the 6-digit code from your authenticator app."
          : "Enter one of the backup codes you saved when you set this up."}
      </AuthTitle>
      <form ref={formRef} onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="code" className="text-sm font-medium">
            {method === "totp" ? "Authentication code" : "Backup code"}
          </label>
          {method === "totp" ? (
            <CodeInput
              id="code"
              value={totp}
              onChange={(value) => {
                setTotp(value);
                // A new try: the last one's error no longer applies.
                if (error && !error.expired) setError(null);
              }}
              onComplete={verify}
              pending={pending}
              autoFocus
              invalid={!!error && !error.expired}
              inputRef={totpRef}
              wide
            />
          ) : (
            <Input
              id="code"
              name="code"
              required
              autoFocus
              autoComplete="one-time-code"
              spellCheck={false}
              autoCapitalize="off"
              maxLength={12}
              placeholder="abcde-12345"
              className="h-9 font-mono tracking-widest"
            />
          )}
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="trust"
            className="mt-0.5 size-4 accent-neutral-900 dark:accent-neutral-100"
          />
          <span>
            Trust this device for 30 days
            <span className="block text-xs text-muted-foreground">
              Only on a device that&apos;s yours. You&apos;ll still need your password.
            </span>
          </span>
        </label>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error.message}
            {error.expired && (
              <>
                {" "}
                <Link href="/login" className="font-medium underline">
                  Sign in again
                </Link>
              </>
            )}
          </p>
        )}
        <Button
          type="submit"
          size="lg"
          disabled={pending || (method === "totp" && totp.length !== 6)}
          className="w-full"
        >
          {pending ? (
            <>
              <Loader2 className="animate-spin" />
              <span>
                Verifying
                <LoadingEllipsis />
              </span>
            </>
          ) : (
            <>
              <ShieldCheck data-icon="inline-start" />
              Verify
            </>
          )}
        </Button>
      </form>
      <div className="flex items-center justify-between gap-2 border-t border-neutral-200 pt-4 text-sm text-muted-foreground dark:border-neutral-800">
        <button
          type="button"
          onClick={switchMethod}
          disabled={pending}
          className="font-medium text-foreground hover:underline disabled:pointer-events-none disabled:opacity-50"
        >
          {method === "totp" ? "Use a backup code" : "Use your authenticator app"}
        </button>
        <Link href="/login" className="hover:text-foreground hover:underline">
          Back to sign in
        </Link>
      </div>
    </>
  );
}
