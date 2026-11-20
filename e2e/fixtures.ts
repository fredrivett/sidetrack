import { randomUUID } from "node:crypto";
import { test as base, expect } from "@playwright/test";
import { auth } from "@/auth/better-auth";
import { getDb } from "@/core/db";
import { addItem } from "@/core/items";
import { createProject } from "@/core/projects";

export { expect };

// What a test sets up, its user included, is written straight to the test
// database (the server's, see playwright.config.ts) through the app's own
// code, rather than through HTTP: faster, and clear of sign-up rate limits.
const SOURCE = "web" as const;
const PASSWORD = "e2e-password";

export type User = {
  id: string;
  email: string;
  password: string;
  /** Adds a list with these items, as if the user had made it. */
  addList(name: string, items?: string[]): { id: string };
};

/**
 * Every test runs as its own new user, signed in, with an empty board, so
 * tests never see each other's data and can run in parallel.
 */
export const test = base.extend<{ user: User }>({
  user: async ({ context, baseURL }, use) => {
    const handle = `e2e${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const email = `${handle}@sidetrack.test`;
    const { headers, response } = await auth.api.signUpEmail({
      body: { email, password: PASSWORD, name: "E2E User", username: handle },
      returnHeaders: true,
    });
    // Sign-up signs in: hand its session cookie to the browser.
    const cookies = (headers.get("set-cookie") ?? "").split(/,(?=\s*[\w.-]+=)/).map((c) => {
      const [name, ...value] = c.split(";")[0].trim().split("=");
      return { name, value: value.join("="), url: baseURL ?? "" };
    });
    await context.addCookies(cookies);
    // Its own client address too: Better Auth rate-limits sign-ins by IP
    // (x-forwarded-for), and parallel tests would otherwise share one.
    const ip = randomUUID().replace(/\D/g, "").padEnd(6, "0");
    await context.setExtraHTTPHeaders({
      "x-forwarded-for": `10.${Number(ip.slice(0, 2)) % 256}.${Number(ip.slice(2, 4)) % 256}.${Number(ip.slice(4, 6)) % 256}`,
    });
    const { db } = getDb();
    await use({
      id: response.user.id,
      email,
      password: PASSWORD,
      addList(name, items = []) {
        const project = createProject(db, response.user.id, { name }, SOURCE);
        for (const title of items) addItem(db, response.user.id, { projectId: project.id, title }, SOURCE);
        return { id: project.id };
      },
    });
  },
});
