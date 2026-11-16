import type { MetadataRoute } from "next";
import { appBaseUrl } from "./site";

// Per request, so the sitemap's address is the instance's own (site.ts).
export const dynamic = "force-dynamic";

// The landing page (/ signed out) is the one page worth indexing. Everything
// else is behind sign-in, or an account page with nothing to find. /login
// isn't disallowed: crawlers must fetch it to see its noindex.
export default async function robots(): Promise<MetadataRoute.Robots> {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/mcp",
        "/settings",
        "/launch",
        "/welcome",
        "/forgot-password",
        "/reset-password",
      ],
    },
    sitemap: `${await appBaseUrl()}/sitemap.xml`,
  };
}
