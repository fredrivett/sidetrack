"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Download, KeyRound, ShieldCheck, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { CodeInput } from "@/components/CodeInput";
import { QrCode } from "@/components/QrCode";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/input";
import { twoFactor } from "@/auth/client";

// One state per screen of the panel, each holding only what that screen
// needs, so no flag combination can show half of two screens.
type View =
  | { kind: "idle" }
  /** Asking for the password before an action that needs it. */
  | { kind: "confirm"; action: "enable" | "codes" | "disable" }
  /** Set up started: scan the code, then prove it with one from the app.
   * The backup codes wait here until then. */
  | { kind: "scan"; totpURI: string; backupCodes: string[] }
  /** Backup codes to save, shown once: after setup, or new ones. */
  | { kind: "codes"; backupCodes: string[] };

const PASSWORD_PROMPT = {
  enable: { title: "Set up two-factor sign-in", submit: "Continue" },
  codes: { title: "Generate new backup codes", submit: "Generate codes" },
  disable: { title: "Turn off two-factor sign-in", submit: "Turn off" },
} as const;

/** The secret in an otpauth:// URI, in groups of four, for typing in by hand
 * when the QR code can't be scanned. */
function manualKey(totpURI: string): string {
  const secret = new URL(totpURI).searchParams.get("secret") ?? "";
  return secret.match(/.{1,4}/g)?.join(" ") ?? secret;
}

/**
 * Two-factor sign-in, in Profile: set it up with an authenticator app (scan,
 * then verify a code, then save backup codes), make new backup codes, or
 * turn it off. Each change asks for the password again; Better Auth makes
 * the change and the audit triggers (migration 0065) log it. Errors show
 * inline, like the other settings panels.
 */
export function TwoFactorPanel({
  email,
  enabled: initialEnabled,
  startSetup = false,
}: {
  email: string;
  enabled: boolean;
  /** Open straight on the password step of setup, scrolled into view, as
   * Get started's "Secure your account" card links here. */
  startSetup?: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [view, setView] = useState<View>(
    startSetup && !initialEnabled ? { kind: "confirm", action: "enable" } : { kind: "idle" },
  );
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (startSetup && !initialEnabled) sectionRef.current?.scrollIntoView({ block: "center" });
  }, [startSetup, initialEnabled]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The code from the app while setting up, checked on its sixth digit.
  const [code, setCode] = useState("");
  const codeRef = useRef<HTMLInputElement>(null);

  const go = (next: View) => {
    setView(next);
    setCode("");
    setError(null);
  };

  /** Runs one Better Auth call, holding the panel meanwhile; returns its data,
   * or undefined after showing what went wrong. */
  async function run<T>(
    call: () => Promise<{ data: T | null; error: { code?: string; status: number; message?: string } | null }>,
    messages: { invalidCode?: string; fallback: string },
  ): Promise<T | undefined> {
    setPending(true);
    setError(null);
    try {
      const res = await call();
      if (res.error || !res.data) {
        setError(
          res.error?.status === 429
            ? "Too many attempts. Wait a few seconds and try again."
            : res.error?.code === "INVALID_PASSWORD"
              ? "Password is incorrect."
              : res.error?.code === "INVALID_CODE" && messages.invalidCode
                ? messages.invalidCode
                : (res.error?.message ?? messages.fallback),
        );
        return undefined;
      }
      return res.data;
    } catch {
      setError(messages.fallback);
      return undefined;
    } finally {
      setPending(false);
    }
  }

  async function onConfirm(event: FormEvent<HTMLFormElement>, action: "enable" | "codes" | "disable") {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    if (action === "enable") {
      const data = await run(() => twoFactor.enable({ password }), {
        fallback: "Couldn't start setting up two-factor sign-in.",
      });
      // Better Auth 1.7 types the result as either an emailed code or an
      // authenticator app's; only the app's carries what the scan view needs.
      if (data) {
        if ("totpURI" in data) go({ kind: "scan", totpURI: data.totpURI, backupCodes: data.backupCodes });
        else setError("Couldn't start setting up two-factor sign-in.");
      }
    } else if (action === "codes") {
      const data = await run(() => twoFactor.generateBackupCodes({ password }), {
        fallback: "Couldn't generate new backup codes.",
      });
      if (data) go({ kind: "codes", backupCodes: data.backupCodes });
    } else {
      const data = await run(() => twoFactor.disable({ password }), {
        fallback: "Couldn't turn off two-factor sign-in.",
      });
      if (!data) return;
      setEnabled(false);
      go({ kind: "idle" });
      toast.success("Two-factor sign-in is off");
      router.refresh();
    }
  }

  async function verify(code: string, backupCodes: string[]) {
    if (pending) return;
    const data = await run(() => twoFactor.verifyTotp({ code }), {
      invalidCode: "That code didn't work. Check the app shows Sidetrack and try the newest code.",
      fallback: "Couldn't check the code.",
    });
    if (!data) {
      setCode("");
      codeRef.current?.focus();
      return;
    }
    setEnabled(true);
    go({ kind: "codes", backupCodes });
    router.refresh();
  }

  return (
    <section
      ref={sectionRef}
      aria-labelledby="two-factor-heading"
      aria-busy={pending || undefined}
      className="space-y-3 rounded-lg border border-border p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="two-factor-heading" className="text-sm font-medium">
          Two-factor sign-in
        </h2>
        {enabled && view.kind !== "codes" && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-500">
            <ShieldCheck className="size-3.5" />
            On
          </span>
        )}
      </div>

      {view.kind === "idle" &&
        (enabled ? (
          <>
            <p className="text-sm text-muted-foreground">
              Signing in asks for a code from your authenticator app after your password. Lost your
              phone? Use a backup code.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => go({ kind: "confirm", action: "codes" })}>
                <KeyRound data-icon="inline-start" />
                New backup codes
              </Button>
              <Button size="sm" variant="destructive" onClick={() => go({ kind: "confirm", action: "disable" })}>
                <ShieldOff data-icon="inline-start" />
                Turn off
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Protect your account with a code from an authenticator app, such as 1Password, Google
              Authenticator or your phone&apos;s Passwords app, as well as your password.
            </p>
            <Button size="sm" onClick={() => go({ kind: "confirm", action: "enable" })}>
              <ShieldCheck data-icon="inline-start" />
              Set up
            </Button>
          </>
        ))}

      {view.kind === "confirm" && (
        <form onSubmit={(e) => onConfirm(e, view.action)} className="space-y-3">
          <p className="text-sm">{PASSWORD_PROMPT[view.action].title}</p>
          {/* Lets password managers fill the password for this account. */}
          <input type="text" name="username" autoComplete="username" value={email} hidden readOnly />
          <Input
            name="password"
            type="password"
            autoComplete="current-password"
            placeholder="Your password"
            aria-label="Your password"
            required
            autoFocus
            aria-disabled={pending || undefined}
            readOnly={pending}
          />
          {view.action === "codes" && (
            <p className="text-xs text-muted-foreground">Your old backup codes stop working.</p>
          )}
          {view.action === "disable" && (
            <p className="text-xs text-muted-foreground">
              Signing in will only ask for your password. Your backup codes stop working.
            </p>
          )}
          <ErrorLine error={error} />
          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              variant={view.action === "disable" ? "destructive" : "default"}
              disabled={pending}
            >
              {pending ? "Checking…" : PASSWORD_PROMPT[view.action].submit}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => go({ kind: "idle" })}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {view.kind === "scan" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void verify(code, view.backupCodes);
          }}
          className="space-y-3"
        >
          <p className="text-sm">
            Scan this with your authenticator app, then enter the 6-digit code it shows.
          </p>
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <QrCode text={view.totpURI} label="QR code to add Sidetrack to an authenticator app" className="size-40 shrink-0" />
            <div className="min-w-0 space-y-1">
              <p className="text-xs text-muted-foreground">Can&apos;t scan it? Enter this key instead:</p>
              <code
                aria-label="Setup key"
                className="block font-mono text-sm break-all select-all"
              >
                {manualKey(view.totpURI)}
              </code>
              <CopyButton value={new URL(view.totpURI).searchParams.get("secret") ?? ""} size="xs">
                Copy key
              </CopyButton>
            </div>
          </div>
          <CodeInput
            label="Code from your app"
            value={code}
            onChange={(value) => {
              setCode(value);
              setError(null);
            }}
            onComplete={(value) => verify(value, view.backupCodes)}
            pending={pending}
            autoFocus
            invalid={!!error}
            inputRef={codeRef}
          />
          <ErrorLine error={error} />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending || code.length !== 6}>
              {pending ? "Verifying…" : "Verify and turn on"}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => go({ kind: "idle" })}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {view.kind === "codes" && <BackupCodes codes={view.backupCodes} onDone={() => go({ kind: "idle" })} />}
    </section>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  );
}

/** The backup codes, shown once, to copy or download before moving on. */
function BackupCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const text = codes.join("\n");
  function download() {
    const url = URL.createObjectURL(
      new Blob([`Sidetrack backup codes\nEach code works once.\n\n${text}\n`], { type: "text/plain" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "sidetrack-backup-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="space-y-3">
      <p className="text-sm">
        Save these backup codes somewhere safe, such as your password manager. If you lose your
        phone, each one signs you in once. They won&apos;t be shown again.
      </p>
      <ul
        aria-label="Backup codes"
        className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-md bg-muted px-4 py-3 font-mono text-sm"
      >
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <CopyButton value={text}>Copy</CopyButton>
        <Button size="sm" variant="outline" onClick={download}>
          <Download data-icon="inline-start" />
          Download
        </Button>
        <Button size="sm" onClick={onDone}>
          I&apos;ve saved them
        </Button>
      </div>
    </div>
  );
}
