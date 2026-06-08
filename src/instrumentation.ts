import { type Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Validate required config before the server accepts any traffic, so a
  // missing production secret fails the boot loudly (container won't start)
  // instead of 500-ing on the first auth request with the cause buried in logs.
  const { assertAuthSecret } = await import("./auth/assert-auth-secret");
  assertAuthSecret({
    secret: process.env.BETTER_AUTH_SECRET,
    nodeEnv: process.env.NODE_ENV,
    nextPhase: process.env.NEXT_PHASE,
  });
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
