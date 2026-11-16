import { headers } from "next/headers";
import { getEnv } from "@/lib/env";

/** What Sidetrack is, for search results, link previews and structured data. */
export const SITE_DESCRIPTION =
  "A calm, self-hostable board for your side projects, with an MCP server built in so your AI agents can keep it up to date.";

/** Absolute base URL for links that leave the app, such as in email or
 * robots.txt: the configured BETTER_AUTH_URL, else derived from the incoming
 * request's headers. */
export async function appBaseUrl(): Promise<string> {
  const configured = getEnv().BETTER_AUTH_URL;
  if (configured) return configured.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : "";
}
