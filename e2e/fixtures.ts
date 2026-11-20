import { randomUUID } from "node:crypto";
import { test as base, expect, type BrowserContext } from "@playwright/test";
import { auth } from "@/auth/better-auth";
import { getDb } from "@/core/db";
import { addItem } from "@/core/items";
import { acceptInvite, inviteMember } from "@/core/members";
import { createProject } from "@/core/projects";
import type { ListRole } from "@/core/schema";

export { expect };

// What a test sets up, its user included, is written straight to the test
// database (the server's, see playwright.config.ts) through the app's own
// code, rather than through HTTP: faster, and clear of sign-up rate limits.
const SOURCE = "web" as const;
const PASSWORD = "e2e-password";

/** Signs `context` in with the session a sign-up or sign-in answered with,
 * from its own client address: Better Auth rate-limits sign-ins by IP
 * (x-forwarded-for), and parallel tests would otherwise share one. */
async function useSession(context: BrowserContext, headers: Headers, baseURL: string) {
  const cookies = (headers.get("set-cookie") ?? "").split(/,(?=\s*[\w.-]+=)/).map((c) => {
    const [name, ...value] = c.split(";")[0].trim().split("=");
    return { name, value: value.join("="), url: baseURL };
  });
  await context.addCookies(cookies);
  const ip = randomUUID().replace(/\D/g, "").padEnd(6, "0");
  await context.setExtraHTTPHeaders({
    "x-forwarded-for": `10.${Number(ip.slice(0, 2)) % 256}.${Number(ip.slice(2, 4)) % 256}.${Number(ip.slice(4, 6)) % 256}`,
  });
}

/** A fresh handle, so parallel tests never share a person. */
const newHandle = () => `e2e${randomUUID().replace(/-/g, "").slice(0, 12)}`;

/** Someone else with an account, not signed in: to share with, or to share
 * with the test's user. */
export async function createPerson() {
  const username = newHandle();
  const { user } = await auth.api.signUpEmail({
    body: { email: `${username}@sidetrack.test`, password: PASSWORD, name: "Other", username },
  });
  const { db } = getDb();
  return {
    id: user.id,
    username,
    /** Signs `context` in as them, as if they'd signed in themselves. */
    async signIn(context: BrowserContext, baseURL: string) {
      const { headers } = await auth.api.signInEmail({
        body: { email: `${username}@sidetrack.test`, password: PASSWORD },
        returnHeaders: true,
      });
      await useSession(context, headers, baseURL);
    },
    /** Adds a list of theirs with these items, shared with `withId` as
     * `role`, invite already accepted. */
    shareList(name: string, items: string[], withId: string, withHandle: string, role: ListRole) {
      const project = createProject(db, user.id, { name }, SOURCE);
      for (const title of items) addItem(db, user.id, { projectId: project.id, title }, SOURCE);
      inviteMember(db, user.id, project.id, withHandle, SOURCE, role);
      acceptInvite(db, withId, project.id, SOURCE);
      return { id: project.id };
    },
  };
}

export type User = {
  id: string;
  username: string;
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
    const handle = newHandle();
    const email = `${handle}@sidetrack.test`;
    const { headers, response } = await auth.api.signUpEmail({
      body: { email, password: PASSWORD, name: "E2E User", username: handle },
      returnHeaders: true,
    });
    // Sign-up signs in: hand its session to the browser.
    await useSession(context, headers, baseURL ?? "");
    const { db } = getDb();
    await use({
      id: response.user.id,
      username: handle,
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
