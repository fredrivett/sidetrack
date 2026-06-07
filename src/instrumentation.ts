import { type Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
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
  const posthog = getPostHog();
  if (!posthog) return;
  await posthog.captureExceptionImmediate(err, undefined, {
    path: request.path,
    method: request.method,
    router_kind: context.routerKind,
    route_path: context.routePath,
    route_type: context.routeType,
  });
};
