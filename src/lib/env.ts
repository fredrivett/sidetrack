import { z } from "zod";
import { parseSecretKey } from "./secretBox";

// Centralized, validated server environment. One schema is the source of truth
// for required/optional config, validated once at boot (instrumentation.ts) so
// a misconfigured deploy fails fast with an actionable message instead of a
// silent runtime error (e.g. Better Auth's 403 INVALID_ORIGIN when
// BETTER_AUTH_URL is unset behind a proxy).
//
// Scope is server runtime config only. `NEXT_PUBLIC_*` vars are intentionally
// NOT here — they're inlined into the client bundle at build time, so routing
// them through a server module would be misleading and break the client/server
// split. Framework signals (NODE_ENV, NEXT_RUNTIME, NEXT_PHASE) are inputs to
// validation, not config we own.

// Better Auth substitutes this public literal when BETTER_AUTH_SECRET is unset.
// A publicly-known signing key is forgeable, so a present-but-default secret is
// as bad as a missing one.
const BETTER_AUTH_DEFAULT_SECRET = "better-auth-secret-12345678901234567890";

const SECRET_MESSAGE =
  "BETTER_AUTH_SECRET is missing (or left at Better Auth's insecure default). " +
  "Session cookies would be signed with a public, forgeable key. Generate one " +
  "with `openssl rand -hex 32` and set it in your environment.";
const URL_MISSING_MESSAGE =
  "BETTER_AUTH_URL is not set. Behind a proxy, Better Auth cannot infer its " +
  "public origin, so auth POSTs are rejected with INVALID_ORIGIN. Set it to " +
  "the public URL you serve from (e.g. https://app.example.com).";
const URL_INVALID_MESSAGE =
  "BETTER_AUTH_URL must be an absolute http(s) URL (e.g. https://app.example.com).";
const EMAIL_FROM_MESSAGE =
  "EMAIL_FROM is required when RESEND_API_KEY is set. Resend rejects sends " +
  'without a verified from address (e.g. "Sidetrack <no-reply@sidetrack.it>").';
const SMTP_URL_MESSAGE =
  "SMTP_URL must be an smtp(s):// URL (e.g. smtp://localhost:1025 for a local " +
  "mail catcher like Mailpit).";

// In development, outbound mail always goes to the local Mailpit catcher
// (`pnpm mailpit`) rather than out to a real provider — so a dev box can never
// send live email, and resets are viewable in Mailpit's web UI. This is the
// default when neither SMTP_URL nor RESEND_API_KEY is set explicitly; set
// RESEND_API_KEY locally to opt into real sends, or SMTP_URL to point at a
// different catcher. Matches the fixed port in docker-compose.dev.yml.
const DEV_SMTP_URL = "smtp://localhost:1025";

export interface EnvMode {
  nodeEnv: string | undefined;
  nextPhase: string | undefined;
}

export interface ServerEnv {
  // Guaranteed present in production; may be undefined in dev/test/build, where
  // Better Auth's zero-config defaults keep local runs working.
  BETTER_AUTH_SECRET: string | undefined;
  BETTER_AUTH_URL: string | undefined;
  ALLOW_SIGNUP: boolean;
  // Offer the founding batches at signup (src/lib/founding.ts). sidetrack.it
  // only: off, as on every self-hosted instance, signup looks as it always has.
  FOUNDING_SEATS: boolean;
  DB_PATH: string;
  BACKUP_DIR: string;
  // Email delivery (password resets). With none set, links are logged to the
  // server console — the self-hosted fallback. SMTP_URL points at a mail
  // catcher (Mailpit) for local dev and takes precedence over Resend.
  SMTP_URL: string | undefined;
  RESEND_API_KEY: string | undefined;
  EMAIL_FROM: string | undefined;
  // Where to email a notice of each new signup. Unset sends none.
  SIGNUP_NOTIFY_EMAIL: string | undefined;
  // Who can open /admin, by user id. Ids rather than emails: signup doesn't
  // verify addresses, so anyone could sign up as a listed email with no
  // account yet. Empty means nobody.
  ADMIN_USER_IDS: string[];
  // TypeSafe Jev key for AI list-icon suggestions. Unset turns them off.
  TYPESAFE_API_KEY: string | undefined;
  // Anthropic key for the Agenda greeting's writer (greetingWriter.ts), with
  // TYPESAFE_API_KEY for Jev's picks. Unset keeps the template greeting.
  ANTHROPIC_API_KEY: string | undefined;
  // The list "Send feedback" files items in. Unset hides the form.
  FEEDBACK_LIST_ID: string | undefined;
  // Email in: the domain users' addresses are on (say, to.sidetrack.it) and
  // the secret the receiving Cloudflare Worker (workers/email-in) signs each
  // email with. Unset turns email in off.
  EMAIL_IN: { domain: string; secret: string } | undefined;
  // Web Push (VAPID) keys and contact, for push notifications. Unset turns
  // push off. The subject defaults to BETTER_AUTH_URL.
  VAPID: { publicKey: string; privateKey: string; subject: string } | undefined;
  // The key calendar passwords are encrypted with (lib/secretBox.ts), 32
  // bytes as base64. Unset turns calendars off. Changing it means everyone
  // reconnects their calendars.
  CALENDAR_SECRET_KEY: Buffer | undefined;
  // Where each daily backup is also uploaded, encrypted (core/backup.ts): an
  // S3-compatible bucket off the server, such as Cloudflare R2. Unset keeps
  // backups on the server only.
  BACKUP_UPLOAD:
    | { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string; key: Buffer }
    | undefined;
}

// Uploading a backup takes all of these; a missing one would only fail at the
// first upload, up to a day after the deploy.
const BACKUP_UPLOAD_VARS = [
  "BACKUP_S3_ENDPOINT",
  "BACKUP_S3_BUCKET",
  "BACKUP_S3_ACCESS_KEY_ID",
  "BACKUP_S3_SECRET_ACCESS_KEY",
  "BACKUP_ENCRYPTION_KEY",
] as const;

// superRefine has checked they come together and the key parses.
function backupUpload(
  env: Partial<Record<(typeof BACKUP_UPLOAD_VARS)[number], string>>,
): ServerEnv["BACKUP_UPLOAD"] {
  const key = env.BACKUP_ENCRYPTION_KEY ? parseSecretKey(env.BACKUP_ENCRYPTION_KEY) : null;
  const { BACKUP_S3_ENDPOINT: endpoint, BACKUP_S3_BUCKET: bucket } = env;
  const { BACKUP_S3_ACCESS_KEY_ID: accessKeyId, BACKUP_S3_SECRET_ACCESS_KEY: secretAccessKey } = env;
  if (!key || !endpoint || !bucket || !accessKeyId || !secretAccessKey) return undefined;
  return { endpoint: endpoint.replace(/\/+$/, ""), bucket, accessKeyId, secretAccessKey, key };
}

// Production-required vars are enforced only when actually running in
// production — not during `next build` (the image is built once without
// runtime secrets) nor in dev/test (zero-config).
function enforcesProduction(mode: EnvMode): boolean {
  return mode.nodeEnv === "production" && mode.nextPhase !== "phase-production-build";
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// A contact push services accept: an https URL with a host, or a mailto: with an address.
function isPushContact(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return url.hostname !== "";
    return url.protocol === "mailto:" && /^[^@\s]+@[^@\s]+$/.test(url.pathname);
  } catch {
    return false;
  }
}

function isSmtpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "smtp:" || url.protocol === "smtps:";
  } catch {
    return false;
  }
}

// Optional string where blank means unset: `EMAIL_FROM=" "` would otherwise
// slip past the RESEND_API_KEY/EMAIL_FROM pairing check below and only fail
// at send time.
const optionalTrimmed = z
  .string()
  .optional()
  .transform((value) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  });

function schemaFor(mode: EnvMode) {
  const enforce = enforcesProduction(mode);
  return z
    .object({
      BETTER_AUTH_SECRET: z.string().optional(),
      BETTER_AUTH_URL: z.string().optional(),
      ALLOW_SIGNUP: z.string().optional(),
      FOUNDING_SEATS: z.string().optional(),
      DB_PATH: z.string().optional(),
      BACKUP_DIR: z.string().optional(),
      SMTP_URL: optionalTrimmed,
      RESEND_API_KEY: optionalTrimmed,
      EMAIL_FROM: optionalTrimmed,
      SIGNUP_NOTIFY_EMAIL: optionalTrimmed,
      ADMIN_USER_IDS: optionalTrimmed,
      TYPESAFE_API_KEY: optionalTrimmed,
      ANTHROPIC_API_KEY: optionalTrimmed,
      FEEDBACK_LIST_ID: optionalTrimmed,
      EMAIL_IN_DOMAIN: optionalTrimmed,
      EMAIL_IN_SECRET: optionalTrimmed,
      VAPID_PUBLIC_KEY: optionalTrimmed,
      VAPID_PRIVATE_KEY: optionalTrimmed,
      VAPID_SUBJECT: optionalTrimmed,
      BACKUP_S3_ENDPOINT: optionalTrimmed,
      BACKUP_S3_BUCKET: optionalTrimmed,
      BACKUP_S3_ACCESS_KEY_ID: optionalTrimmed,
      BACKUP_S3_SECRET_ACCESS_KEY: optionalTrimmed,
      BACKUP_ENCRYPTION_KEY: optionalTrimmed,
      CALENDAR_SECRET_KEY: optionalTrimmed,
    })
    .superRefine((env, ctx) => {
      // A domain without a secret couldn't check the Worker's deliveries, and
      // a secret without a domain has no addresses to hand out.
      if (!env.EMAIL_IN_DOMAIN !== !env.EMAIL_IN_SECRET) {
        ctx.addIssue({
          code: "custom",
          path: ["EMAIL_IN_SECRET"],
          message:
            "EMAIL_IN_DOMAIN and EMAIL_IN_SECRET go together: set both (the secret " +
            "is the one the email-in Worker signs with) or neither.",
        });
      }
      // Half a key pair would only fail when the first push is sent.
      if (!env.VAPID_PUBLIC_KEY !== !env.VAPID_PRIVATE_KEY) {
        ctx.addIssue({
          code: "custom",
          path: ["VAPID_PRIVATE_KEY"],
          message:
            "VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY go together: set both (generate " +
            "them with `npx web-push generate-vapid-keys`) or neither.",
        });
      }
      // A mistyped key would only fail when a push is sent: the public key
      // is a P-256 point (65 bytes), the private key 32 bytes, base64url.
      const b64u = (value: string | undefined, bytes: number) =>
        !value ||
        (/^[A-Za-z0-9_-]+$/.test(value) && Buffer.from(value, "base64url").length === bytes);
      if (!b64u(env.VAPID_PUBLIC_KEY, 65) || !b64u(env.VAPID_PRIVATE_KEY, 32)) {
        ctx.addIssue({
          code: "custom",
          path: ["VAPID_PUBLIC_KEY"],
          message:
            "VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY isn't a Web Push key; copy both from " +
            "`npx web-push generate-vapid-keys` whole.",
        });
      }
      // A key that isn't 32 bytes would only fail when someone connects a calendar.
      if (env.CALENDAR_SECRET_KEY && !parseSecretKey(env.CALENDAR_SECRET_KEY)) {
        ctx.addIssue({
          code: "custom",
          path: ["CALENDAR_SECRET_KEY"],
          message:
            "CALENDAR_SECRET_KEY must be 32 bytes as base64; generate one with " +
            "`openssl rand -base64 32`.",
        });
      }
      const backupSet = BACKUP_UPLOAD_VARS.filter((name) => env[name]);
      if (backupSet.length > 0 && backupSet.length < BACKUP_UPLOAD_VARS.length) {
        ctx.addIssue({
          code: "custom",
          path: ["BACKUP_S3_ENDPOINT"],
          message: `${BACKUP_UPLOAD_VARS.join(", ")} go together to upload backups: set all or none.`,
        });
      }
      if (env.BACKUP_S3_ENDPOINT && !isHttpUrl(env.BACKUP_S3_ENDPOINT)) {
        ctx.addIssue({
          code: "custom",
          path: ["BACKUP_S3_ENDPOINT"],
          message:
            "BACKUP_S3_ENDPOINT must be the bucket service's https:// URL, such as " +
            "https://<account-id>.r2.cloudflarestorage.com.",
        });
      }
      // A key that isn't 32 bytes would only fail at the first upload.
      if (env.BACKUP_ENCRYPTION_KEY && !parseSecretKey(env.BACKUP_ENCRYPTION_KEY)) {
        ctx.addIssue({
          code: "custom",
          path: ["BACKUP_ENCRYPTION_KEY"],
          message:
            "BACKUP_ENCRYPTION_KEY must be 32 bytes as base64; generate one with " +
            "`openssl rand -base64 32`.",
        });
      }
      // Push services reject a push with no contact, and Apple rejects one
      // that isn't a mailto: or https: URL.
      const subject = env.VAPID_SUBJECT ?? env.BETTER_AUTH_URL;
      if (env.VAPID_PUBLIC_KEY && !isPushContact(subject)) {
        ctx.addIssue({
          code: "custom",
          path: ["VAPID_SUBJECT"],
          message:
            "Push needs a contact: set VAPID_SUBJECT to a mailto: or https:// URL " +
            "(it defaults to BETTER_AUTH_URL when that's https).",
        });
      }
      if (enforce) {
        if (
          !env.BETTER_AUTH_SECRET ||
          env.BETTER_AUTH_SECRET === BETTER_AUTH_DEFAULT_SECRET
        ) {
          ctx.addIssue({
            code: "custom",
            path: ["BETTER_AUTH_SECRET"],
            message: SECRET_MESSAGE,
          });
        }
        if (!env.BETTER_AUTH_URL) {
          ctx.addIssue({
            code: "custom",
            path: ["BETTER_AUTH_URL"],
            message: URL_MISSING_MESSAGE,
          });
        }
      }
      // Validate format whenever a URL is provided, even in dev — a malformed
      // value is always wrong.
      if (env.BETTER_AUTH_URL && !isHttpUrl(env.BETTER_AUTH_URL)) {
        ctx.addIssue({
          code: "custom",
          path: ["BETTER_AUTH_URL"],
          message: URL_INVALID_MESSAGE,
        });
      }
      // Setting the Resend key signals intent to send real email, so an
      // unusable from address is a misconfiguration in every mode.
      if (env.RESEND_API_KEY && !env.EMAIL_FROM) {
        ctx.addIssue({
          code: "custom",
          path: ["EMAIL_FROM"],
          message: EMAIL_FROM_MESSAGE,
        });
      }
      // A malformed SMTP_URL would only blow up at send time, so reject it up
      // front. EMAIL_FROM is NOT required here — the SMTP/dev path defaults it.
      if (env.SMTP_URL && !isSmtpUrl(env.SMTP_URL)) {
        ctx.addIssue({
          code: "custom",
          path: ["SMTP_URL"],
          message: SMTP_URL_MESSAGE,
        });
      }
      // A typo would only surface when someone signs up, and notifySignup
      // swallows send failures, so reject it at boot instead.
      if (
        env.SIGNUP_NOTIFY_EMAIL &&
        !z.email().safeParse(env.SIGNUP_NOTIFY_EMAIL).success
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["SIGNUP_NOTIFY_EMAIL"],
          message: "SIGNUP_NOTIFY_EMAIL must be an email address, e.g. you@example.com.",
        });
      }
    })
    .transform((env) => ({
      BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
      BETTER_AUTH_URL: env.BETTER_AUTH_URL,
      ALLOW_SIGNUP: env.ALLOW_SIGNUP === "true",
      FOUNDING_SEATS: env.FOUNDING_SEATS === "true",
      DB_PATH: env.DB_PATH ?? "./data/sidetrack.db",
      BACKUP_DIR: env.BACKUP_DIR ?? "./data/backups",
      // Development with no explicit mail config → the local Mailpit catcher.
      // An explicit SMTP_URL or RESEND_API_KEY (real sends) opts out.
      SMTP_URL:
        env.SMTP_URL ??
        (mode.nodeEnv === "development" && !env.RESEND_API_KEY
          ? DEV_SMTP_URL
          : undefined),
      RESEND_API_KEY: env.RESEND_API_KEY,
      EMAIL_FROM: env.EMAIL_FROM,
      SIGNUP_NOTIFY_EMAIL: env.SIGNUP_NOTIFY_EMAIL,
      ADMIN_USER_IDS: (env.ADMIN_USER_IDS ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
      TYPESAFE_API_KEY: env.TYPESAFE_API_KEY,
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
      FEEDBACK_LIST_ID: env.FEEDBACK_LIST_ID,
      CALENDAR_SECRET_KEY: env.CALENDAR_SECRET_KEY ? (parseSecretKey(env.CALENDAR_SECRET_KEY) ?? undefined) : undefined,
      BACKUP_UPLOAD: backupUpload(env),
      EMAIL_IN:
        env.EMAIL_IN_DOMAIN && env.EMAIL_IN_SECRET
          ? { domain: env.EMAIL_IN_DOMAIN.toLowerCase(), secret: env.EMAIL_IN_SECRET }
          : undefined,
      VAPID:
        // superRefine checked that a key pair comes with a subject.
        env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
          ? {
              publicKey: env.VAPID_PUBLIC_KEY,
              privateKey: env.VAPID_PRIVATE_KEY,
              subject: env.VAPID_SUBJECT ?? env.BETTER_AUTH_URL ?? "",
            }
          : undefined,
    }));
}

/**
 * Validate raw environment against the schema for the given mode. Pure (takes
 * env + mode as args) so it's unit-testable without touching process.env.
 * Throws a single aggregated, actionable error listing every problem at once.
 */
export function parseServerEnv(
  raw: Record<string, string | undefined>,
  mode: EnvMode,
): ServerEnv {
  const result = schemaFor(mode).safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  - ${issue.message}`,
    );
    throw new Error(
      `Invalid environment configuration:\n${lines.join("\n")}\n\n` +
        "See the Configuration section of docs/self-hosting.md.",
    );
  }
  return result.data;
}

let cached: ServerEnv | undefined;

/**
 * Memoized, validated server env for app code to read (instead of scattered
 * process.env access). Parses on first call; instrumentation.ts calls this at
 * boot so production misconfiguration fails the container startup.
 */
export function getEnv(): ServerEnv {
  if (!cached) {
    cached = parseServerEnv(process.env, {
      nodeEnv: process.env.NODE_ENV,
      nextPhase: process.env.NEXT_PHASE,
    });
  }
  return cached;
}
