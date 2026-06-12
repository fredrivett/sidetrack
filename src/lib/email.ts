import nodemailer from "nodemailer";

import { getEnv } from "./env";

// Email delivery for auth flows. Three modes, picked by which env vars are set:
//
//   1. SMTP_URL   → send over SMTP. The local-dev path: point it at a mail
//                   catcher (Mailpit, `pnpm mailpit`) to view mail in a web UI
//                   instead of sending it. Checked first so a stray
//                   RESEND_API_KEY can never leak real mail out of a dev box.
//   2. RESEND_API_KEY → POST to Resend's HTTP API (hosted instances). One
//                   endpoint, so we call it with fetch rather than pulling in
//                   their SDK. env.ts enforces that EMAIL_FROM accompanies it.
//   3. neither    → log the link to the server console, where a self-hosted
//                   operator can copy it for the user.

const RESEND_ENDPOINT = "https://api.resend.com/emails";

// From address for the SMTP/dev path. Mailpit accepts anything, so unlike
// Resend this needs no verified domain — fall back to a placeholder when
// EMAIL_FROM is unset so devs don't have to configure one to catch mail.
const SMTP_DEFAULT_FROM = "Sidetrack <no-reply@sidetrack.local>";

export interface EmailEnv {
  SMTP_URL: string | undefined;
  RESEND_API_KEY: string | undefined;
  EMAIL_FROM: string | undefined;
}

export interface OutboundEmail {
  from: string;
  to: string;
  subject: string;
  text: string;
}

export interface EmailDeps {
  env: EmailEnv;
  fetchFn: typeof fetch;
  log: (message: string) => void;
  // SMTP transport, injected so the core stays pure/testable. The default
  // wiring (`sendPasswordResetEmail`) supplies a memoized nodemailer transport.
  sendSmtp: (smtpUrl: string, message: OutboundEmail) => Promise<void>;
}

// A ready-to-send message plus the two per-message strings the transport needs:
// `logLine` (the no-transport console fallback, carrying the actionable URL so a
// self-hosted operator can copy it) and `errorLabel` (the noun in a Resend
// rejection, e.g. "password reset email").
interface DeliverableEmail {
  to: string;
  subject: string;
  text: string;
  logLine: string;
  errorLabel: string;
}

/**
 * Shared transport: SMTP if configured, else Resend, else log the fallback.
 * The message-specific copy is built by the per-email builders below, so the
 * SMTP and Resend paths can never drift. Throws on a failed Resend/SMTP call —
 * callers decide how loudly to surface that.
 */
async function deliverEmail(
  message: DeliverableEmail,
  { env, fetchFn, log, sendSmtp }: EmailDeps,
): Promise<void> {
  const { to, subject, text } = message;

  if (env.SMTP_URL) {
    await sendSmtp(env.SMTP_URL, {
      from: env.EMAIL_FROM ?? SMTP_DEFAULT_FROM,
      to,
      subject,
      text,
    });
    return;
  }

  if (!env.RESEND_API_KEY) {
    log(message.logLine);
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
      subject,
      text,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Resend rejected the ${message.errorLabel} (${res.status}): ${body.slice(0, 200)}`,
    );
  }
}

// Single source of truth for the reset email's copy.
function passwordResetMessage(url: string): { subject: string; text: string } {
  return {
    subject: "Reset your Sidetrack password",
    text:
      "Someone (hopefully you) asked to reset the password for this " +
      `Sidetrack account.\n\nReset it here: ${url}\n\nThe link expires in ` +
      "1 hour. If you didn't ask for this, you can ignore this email — " +
      "your password is unchanged.",
  };
}

/**
 * Pure-dependency core, exported for tests; app code uses
 * `sendPasswordResetEmail` below. The password-reset wiring logs a Resend
 * failure server-side only, since its HTTP response must stay identical
 * whether or not the account exists.
 */
export async function deliverPasswordResetEmail(
  { to, url }: { to: string; url: string },
  deps: EmailDeps,
): Promise<void> {
  const { subject, text } = passwordResetMessage(url);
  await deliverEmail(
    {
      to,
      subject,
      text,
      logLine: `[email] no SMTP_URL or RESEND_API_KEY set — password reset link for ${to}: ${url}`,
      errorLabel: "password reset email",
    },
    deps,
  );
}

// Single source of truth for the project-invite email's copy.
function inviteMessage({
  inviterName,
  projectName,
  url,
}: {
  inviterName: string;
  projectName: string;
  url: string;
}): { subject: string; text: string } {
  return {
    subject: `${inviterName} invited you to a Sidetrack project`,
    text:
      `${inviterName} invited you to collaborate on "${projectName}" in ` +
      `Sidetrack.\n\nOpen Sidetrack to accept: ${url}\n\nIf you weren't ` +
      "expecting this, you can ignore this email — nothing changes until you " +
      "accept.",
  };
}

/** Pure-dependency core for the invite email; app code uses `sendInviteEmail`. */
export async function deliverInviteEmail(
  {
    to,
    inviterName,
    projectName,
    url,
  }: { to: string; inviterName: string; projectName: string; url: string },
  deps: EmailDeps,
): Promise<void> {
  const { subject, text } = inviteMessage({ inviterName, projectName, url });
  await deliverEmail(
    {
      to,
      subject,
      text,
      logLine: `[email] no SMTP_URL or RESEND_API_KEY set — project invite for ${to}: ${url}`,
      errorLabel: "invite email",
    },
    deps,
  );
}

// Drop any embedded credentials (smtp://user:pass@host) before a URL reaches
// a log line, keeping only scheme + host:port for diagnostics. Falls back to a
// generic label if the value somehow doesn't parse as a URL.
export function redactSmtpUrl(smtpUrl: string): string {
  try {
    const { protocol, host } = new URL(smtpUrl);
    return `${protocol}//${host}`;
  } catch {
    return "the configured SMTP server";
  }
}

// Memoized transport: nodemailer pools connections, so reusing one transport
// across sends avoids reconnecting to the catcher on every password reset.
let smtpTransport: { url: string; transport: nodemailer.Transporter } | null =
  null;

async function sendViaSmtp(
  smtpUrl: string,
  message: OutboundEmail,
): Promise<void> {
  if (!smtpTransport || smtpTransport.url !== smtpUrl) {
    smtpTransport = { url: smtpUrl, transport: nodemailer.createTransport(smtpUrl) };
  }
  try {
    await smtpTransport.transport.sendMail(message);
  } catch (cause) {
    // The common case in dev: the catcher isn't running. Connection errors are
    // cryptic (ECONNREFUSED), so point straight at the fix — this surfaces in
    // the server log via the password-reset wiring.
    const code = (cause as { code?: string })?.code;
    if (code === "ECONNREFUSED" || code === "ESOCKET") {
      throw new Error(
        `Could not reach the SMTP mail catcher at ${redactSmtpUrl(smtpUrl)}. ` +
          "Is it running? Start it with `pnpm mailpit`.",
        { cause },
      );
    }
    throw cause;
  }
}

function liveDeps(): EmailDeps {
  const env = getEnv();
  return {
    env: {
      SMTP_URL: env.SMTP_URL,
      RESEND_API_KEY: env.RESEND_API_KEY,
      EMAIL_FROM: env.EMAIL_FROM,
    },
    fetchFn: fetch,
    log: console.log,
    sendSmtp: sendViaSmtp,
  };
}

export async function sendPasswordResetEmail(opts: {
  to: string;
  url: string;
}): Promise<void> {
  await deliverPasswordResetEmail(opts, liveDeps());
}

export async function sendInviteEmail(opts: {
  to: string;
  inviterName: string;
  projectName: string;
  url: string;
}): Promise<void> {
  await deliverInviteEmail(opts, liveDeps());
}

/**
 * Best-effort invite notification: sends the email but never throws — a
 * delivery failure is logged and swallowed, because the invitee's in-app
 * invite banner is the source of truth, not the email. Both the web action and
 * the MCP tool call this after the invite is already persisted.
 */
export async function notifyInvite(opts: {
  to: string;
  inviterName: string;
  projectName: string;
  url: string;
}): Promise<void> {
  try {
    await sendInviteEmail(opts);
  } catch (err) {
    console.error("[invite] email send failed:", err);
  }
}
