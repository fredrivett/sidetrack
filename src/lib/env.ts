import { z } from "zod";

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
  DB_PATH: string;
  BACKUP_DIR: string;
  // Email delivery (password resets). With none set, links are logged to the
  // server console — the self-hosted fallback. SMTP_URL points at a mail
  // catcher (Mailpit) for local dev and takes precedence over Resend.
  SMTP_URL: string | undefined;
  RESEND_API_KEY: string | undefined;
  EMAIL_FROM: string | undefined;
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
      DB_PATH: z.string().optional(),
      BACKUP_DIR: z.string().optional(),
      SMTP_URL: optionalTrimmed,
      RESEND_API_KEY: optionalTrimmed,
      EMAIL_FROM: optionalTrimmed,
    })
    .superRefine((env, ctx) => {
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
    })
    .transform((env) => ({
      BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
      BETTER_AUTH_URL: env.BETTER_AUTH_URL,
      ALLOW_SIGNUP: env.ALLOW_SIGNUP === "true",
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
        "See the README's Configuration section.",
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
