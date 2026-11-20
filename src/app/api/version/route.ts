import { RELEASE } from "@/lib/release";

/**
 * The commit the server is running, so an open page can tell it's on an older
 * deploy before it asks for fresh data (refreshIfCurrent in LatestDeploy).
 */
export function GET() {
  return new Response(RELEASE, {
    headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
  });
}
