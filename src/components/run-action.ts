import { unstable_rethrow } from "next/navigation";
import posthog from "posthog-js";
import { toast } from "sonner";

/**
 * Waits for a Server Action and, if it fails, says so in a toast: "Couldn't
 * `what`. Please try again." Every save the UI starts goes through this, so
 * none fails silently or throws into a transition, where React hands the
 * error to the error boundary and replaces the page. Production hides the
 * thrown message, so the toast names the change instead.
 *
 * Next's own control flow, such as the redirect to /login when the session
 * has expired, isn't a failure: it's rethrown for Next to handle. Real
 * failures are still reported to PostHog, as the error boundary would.
 *
 * Resolves to whether it succeeded, for callers that go on afterwards. To use
 * what a read returns, chain it on: `runAction(read().then(setRows), …)`.
 */
export async function runAction(action: Promise<unknown>, what: string): Promise<boolean> {
  try {
    await action;
    return true;
  } catch (error) {
    unstable_rethrow(error);
    posthog.captureException(error);
    toast.error(`Couldn't ${what}. Please try again.`);
    return false;
  }
}
