import { defineConfig, devices } from "@playwright/test";

// End-to-end tests against the production build: run `pnpm build` first.
// See e2e/AGENTS.md for how to write them.
const PORT = 3200;
const BASE_URL = `http://localhost:${PORT}`;
// The server's settings. Test workers get them too: they create each test's
// user and data in the same throwaway database, fresh each run, with the same
// auth secret, so the server accepts their sessions (e2e/fixtures.ts).
const env = {
  DB_PATH: "test-results/e2e.db",
  BACKUP_DIR: "test-results/backups",
  BETTER_AUTH_URL: BASE_URL,
  BETTER_AUTH_SECRET: "e2e-only-secret-0123456789abcdef0123456789",
  ALLOW_SIGNUP: "true",
  // The admin e2e/fixtures.ts's createAdmin makes.
  ADMIN_USER_IDS: "e2e-admin",
};
Object.assign(process.env, env);

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  // A retry only collects a trace; a test that needs it is flaky: fix it.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  // Most waits are on the server; anything slower than this is a bug.
  timeout: 15_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    timezoneId: "Europe/London",
    locale: "en-GB",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `rm -f ${env.DB_PATH}* && pnpm db:migrate && pnpm start -p ${PORT}`,
    url: `${BASE_URL}/login`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { ...env, NODE_ENV: "production" },
  },
});
