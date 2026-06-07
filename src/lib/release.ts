/**
 * The commit this build was produced from, or "" when the deploy pipeline
 * didn't provide one (e.g. local dev). Resolved at build time in
 * `next.config.ts` and inlined as `NEXT_PUBLIC_RELEASE` for both server and
 * client. Attached to PostHog captures so an incident points back at the
 * commit/PR that shipped it.
 */
export const RELEASE = process.env.NEXT_PUBLIC_RELEASE ?? "";
