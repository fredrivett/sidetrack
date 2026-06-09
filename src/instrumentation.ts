import { type Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Validate required config before the server accepts any traffic, so a
  // misconfigured deploy fails the boot loudly (container won't start) instead
  // of silently failing on the first auth request — e.g. a missing secret, or a
  // missing BETTER_AUTH_URL that surfaces only as a 403 INVALID_ORIGIN behind a
  // proxy. getEnv() throws one aggregated, actionable error listing every gap.
  const { getEnv } = await import("./lib/env");
  getEnv();
  const { runMigrations } = await import("./core/migrate");
  const { scheduleBackups } = await import("./core/backup");
  runMigrations();
  scheduleBackups();
}

// Server-side error tracking. No-op unless POSTHOG_KEY is set (see lib/posthog).
export const onRequestError: Instrumentation.onRequestError = async (
  err,
  request,
  context,
) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getPostHog } = await import("./lib/posthog");
  const { RELEASE } = await import("./lib/release");
  const posthog = getPostHog();
  if (!posthog) return;
  await posthog.captureExceptionImmediate(err, undefined, {
    // Strip the query string — it can carry tokens/PII and adds nothing to
    // error grouping (route_path below already captures the template).
    path: request.path.split("?")[0],
    method: request.method,
    router_kind: context.routerKind,
    route_path: context.routePath,
    route_type: context.routeType,
    // The commit that shipped this failure, when the build provided one.
    ...(RELEASE ? { release: RELEASE } : {}),
  });
};
