/**
 * Sanitize a post-login `next` redirect target into a safe same-origin path.
 *
 * Next.js hands back `string | string[]` for a repeated query param, so the
 * type is guarded. Only same-origin absolute paths are allowed: protocol-
 * relative targets (`//host`, and `/\host` since browsers normalise `\` to
 * `/`) sail past a bare `startsWith("/")` and become an open redirect.
 *
 * Shared by the login page (server) and LoginForm (client) so the navigation
 * is validated at the point it happens, not just where the value originates.
 */
export function sanitizeNext(next: string | string[] | undefined): string {
  if (typeof next !== "string") return "/";
  if (!next.startsWith("/")) return "/";
  if (next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}
