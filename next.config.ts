import type { NextConfig } from "next";

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

export default nextConfig;
