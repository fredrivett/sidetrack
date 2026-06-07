import type { NextConfig } from "next";
import { withPostHogConfig } from "@posthog/nextjs-config";

// The commit this build came from. The deploy pipeline sets SOURCE_COMMIT (CI
// builds fall back to GITHUB_SHA); empty when unknown, in which case captures
// simply carry no release tag — same opt-in posture as the PostHog key itself.
const release =
  process.env.SOURCE_COMMIT ??
  process.env.GITHUB_SHA ??
  process.env.VERCEL_GIT_COMMIT_SHA ??
  "";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  // Inlined into both bundles so server + client error capture can tag it.
  env: { NEXT_PUBLIC_RELEASE: release },
};

// Source-map upload happens at build time, but only when the build is given
// PostHog credentials (the hosted sidetrack.it deploy). A self-hoster or a
// local build without them gets the plain config and uploads nothing — so
// stack traces are readable for us without forcing anything on self-hosters.
// These are a personal API key + project id, distinct from the ingestion key.
const personalApiKey = process.env.POSTHOG_API_KEY;
const projectId = process.env.POSTHOG_PROJECT_ID;

export default personalApiKey && projectId
  ? withPostHogConfig(nextConfig, {
      personalApiKey,
      projectId,
      host: process.env.POSTHOG_API_HOST ?? "https://us.posthog.com",
      sourcemaps: {
        enabled: true,
        releaseName: "sidetrack",
        releaseVersion: release || undefined,
        deleteAfterUpload: true,
      },
    })
  : nextConfig;
