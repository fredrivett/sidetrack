// Client-side username rules, mirrored from the Better Auth `username` plugin
// config in src/auth/better-auth.ts. The server is the source of truth (the
// plugin re-validates and owns uniqueness); this just gives instant feedback
// before a round-trip. Framework-agnostic so both the sign-up form and the
// settings panel can share it.

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;
// Allowed charset: alphanumerics, underscores, dots. Notably no `-` or `/`,
// which keeps handles from ever colliding with item-ref separators.
export const USERNAME_RE = /^[a-zA-Z0-9_.]+$/;

// Handles that would collide with routes, the legacy single-user placeholder,
// or future qualified item refs (`username/ENG-42`). Lowercased; compare
// case-insensitively. Single source of truth for both the sign-up/rename
// validator (better-auth.ts) and the migration backfill (which seeds these as
// "taken" so a derived handle never lands on one).
export const RESERVED_USERNAMES = new Set([
  "me",
  "admin",
  "administrator",
  "root",
  "support",
  "help",
  "api",
  "mcp",
  "app",
  "settings",
  "login",
  "logout",
  "signin",
  "signup",
  "auth",
  "system",
  "null",
  "undefined",
]);

export function isReservedUsername(value: string): boolean {
  return RESERVED_USERNAMES.has(value.toLowerCase());
}

/** Returns a human-readable error string, or null if the handle is well-formed. */
export function validateUsername(value: string): string | null {
  if (value.length < USERNAME_MIN) return `At least ${USERNAME_MIN} characters.`;
  if (value.length > USERNAME_MAX) return `At most ${USERNAME_MAX} characters.`;
  if (!USERNAME_RE.test(value))
    return "Letters, numbers, dots and underscores only.";
  return null;
}

/**
 * Derive a *base* handle from an email, normalized to the allowed charset:
 * the local-part (before `@`), lowercased, with disallowed characters stripped,
 * padded to the minimum length and truncated to the maximum. The result is not
 * guaranteed unique — callers de-duplicate against the existing set (see
 * backfillUsernames). Used for migration backfill today and OAuth defaults
 * later, where a handle must be invented rather than chosen.
 */
export function deriveUsername(email: string): string {
  const local = (email.split("@")[0] ?? "").toLowerCase();
  const base = local.replace(/[^a-z0-9_.]/g, "");
  if (base.length < USERNAME_MIN) return (base + "000").slice(0, USERNAME_MIN);
  if (base.length > USERNAME_MAX) return base.slice(0, USERNAME_MAX);
  return base;
}
