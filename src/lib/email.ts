import { getEnv } from "./env";

// Email delivery for auth flows. With RESEND_API_KEY set (hosted instances)
// mail goes out via Resend's HTTP API — a single endpoint, so we call it with
// fetch rather than pulling in their SDK. Without a key (self-hosted) the
// fallback logs the reset link to the server console, where the operator can
// copy it for the user. env.ts enforces that EMAIL_FROM accompanies the key.

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export interface EmailEnv {
  RESEND_API_KEY: string | undefined;
  EMAIL_FROM: string | undefined;
}

export interface EmailDeps {
  env: EmailEnv;
  fetchFn: typeof fetch;
  log: (message: string) => void;
}

/**
 * Pure-dependency core, exported for tests; app code uses
 * `sendPasswordResetEmail` below. Throws on a failed Resend call — callers
 * decide how loudly to surface that (the password-reset wiring logs it
 * server-side only, since its HTTP response must stay identical whether or
 * not the account exists).
 */
export async function deliverPasswordResetEmail(
  { to, url }: { to: string; url: string },
  { env, fetchFn, log }: EmailDeps,
): Promise<void> {
  if (!env.RESEND_API_KEY) {
    log(
      `[email] RESEND_API_KEY not set — password reset link for ${to}: ${url}`,
    );
    return;
  }

  const res = await fetchFn(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [to],
      subject: "Reset your Sidetrack password",
      text:
        "Someone (hopefully you) asked to reset the password for this " +
        `Sidetrack account.\n\nReset it here: ${url}\n\nThe link expires in ` +
        "1 hour. If you didn't ask for this, you can ignore this email — " +
        "your password is unchanged.",
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Resend rejected the password reset email (${res.status}): ${body.slice(0, 200)}`,
    );
  }
}

export async function sendPasswordResetEmail(opts: {
  to: string;
  url: string;
}): Promise<void> {
  await deliverPasswordResetEmail(opts, {
    env: getEnv(),
    fetchFn: fetch,
    log: console.log,
  });
}
