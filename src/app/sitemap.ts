import type { MetadataRoute } from "next";
import { appBaseUrl } from "./site";

// Per request, so its addresses are the instance's own (site.ts).
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = await appBaseUrl();
  return [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/login`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
