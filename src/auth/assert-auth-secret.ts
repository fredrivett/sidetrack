// Mirrors Better Auth's internal DEFAULT_SECRET (better-auth/dist/utils/
// constants.mjs). When BETTER_AUTH_SECRET is unset, Better Auth substitutes
// this public literal to sign session cookies. A publicly-known signing key
// is forgeable, so Better Auth itself throws on it in production — but only
// lazily, on the first auth request, surfacing as an opaque runtime error
// with no stack trace. We assert eagerly at module load instead, so a
// misconfigured deploy fails fast with an actionable message.
const BETTER_AUTH_DEFAULT_SECRET = "better-auth-secret-12345678901234567890";

export interface AuthSecretEnv {
  secret: string | undefined;
  nodeEnv: string | undefined;
  nextPhase: string | undefined;
}

/**
 * Throw if BETTER_AUTH_SECRET is missing or left at the insecure default in
 * production. No-op in development/test (Better Auth's default keeps local
 * runs zero-config) and during `next build` (the image is built once without
 * runtime secrets; the operator supplies the secret at run time).
 */
export function assertAuthSecret({
  secret,
  nodeEnv,
  nextPhase,
}: AuthSecretEnv): void {
  if (nodeEnv !== "production") return;
  if (nextPhase === "phase-production-build") return;

  if (!secret || secret === BETTER_AUTH_DEFAULT_SECRET) {
    throw new Error(
      "BETTER_AUTH_SECRET is not set in production. Without it, session " +
        "cookies are signed with a public default secret and can be forged. " +
        "Generate one with `openssl rand -hex 32` and set BETTER_AUTH_SECRET " +
        "in your environment (see the README's Configuration section).",
    );
  }
}
