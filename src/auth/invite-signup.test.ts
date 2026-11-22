import { beforeAll, describe, expect, it, vi } from "vitest";

// The real Better Auth instance on a closed instance (no ALLOW_SIGNUP): the
// first sign-up takes the only place, and after that only an invite's link
// lets anyone in. Its own file, as the gate is read when the module loads.
vi.hoisted(() => {
  process.env.DB_PATH = ":memory:";
  delete process.env.ALLOW_SIGNUP;
  process.env.BETTER_AUTH_SECRET = "test-secret-for-the-invite-suite-0123456789ab";
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
});
vi.mock("@/lib/email", () => ({
  sendPasswordResetEmail: async () => {},
  notifySignup: async () => {},
}));

import { listDayShares } from "@/core/dayShares";
import { findInvitation, inviteByEmail } from "@/core/invitations";
import { createProject } from "@/core/projects";

type Auth = (typeof import("./better-auth"))["auth"];
let auth: Auth;
let db: ReturnType<(typeof import("@/core/db"))["getDb"]>["db"];

beforeAll(async () => {
  const { runMigrations } = await import("@/core/migrate");
  runMigrations();
  db = (await import("@/core/db")).getDb().db;
  ({ auth } = await import("./better-auth"));
});

const signUp = (name: string, invite?: string) =>
  auth.api.signUpEmail({
    body: { email: `${name}@example.com`, password: "first-pass-1", name, username: name, ...(invite !== undefined && { invite }) },
  });

describe("signing up from an invite on a closed instance", () => {
  it("lets in only someone with an open invite's link, once, and accepts it", async () => {
    const fred = (await signUp("fred")).user.id;
    await expect(signUp("stranger")).rejects.toThrow(/Sign-up is closed/);
    await expect(signUp("guesser", "not-a-real-token")).rejects.toThrow(/Sign-up is closed/);

    const home = createProject(db, fred, { name: "Home" }, "web").id;
    const { token } = inviteByEmail(
      db,
      fred,
      { email: "jo@example.com", places: [{ kind: "list", id: home, role: "commenter", onlyMine: true, within: "today", shareNote: true }] },
      "web",
    );
    // A different address from the one invited: the link is what counts.
    const jo = (await signUp("joanna", token)).user.id;
    expect(listDayShares(db, fred)).toMatchObject([{ personId: jo, within: "today", note: true, pending: false }]);
    expect(findInvitation(db, token)).toMatchObject({ status: "accepted", acceptedBy: jo });

    // Used: the same link lets nobody else in.
    await expect(signUp("samuel", token)).rejects.toThrow(/Sign-up is closed/);
  });

  it("refuses an expired invite's link", async () => {
    const fred = (await auth.api.signInEmail({ body: { email: "fred@example.com", password: "first-pass-1" } })).user.id;
    const long = Date.now() - 31 * 24 * 60 * 60 * 1000;
    const { token } = inviteByEmail(db, fred, { email: "late@example.com", places: [] }, "web", long);
    await expect(signUp("late", token)).rejects.toThrow(/Sign-up is closed/);
    expect(findInvitation(db, token)?.status).toBe("expired");
  });

  it("lets in only one of several sign-ups made at once with the same link", async () => {
    const fred = (await auth.api.signInEmail({ body: { email: "fred@example.com", password: "first-pass-1" } })).user.id;
    const { token } = inviteByEmail(db, fred, { email: "many@example.com", places: [] }, "web");
    const tries = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => `racer${i}`).map((n) => signUp(n, token)));
    expect(tries.filter((t) => t.status === "fulfilled")).toHaveLength(1);
  });
});
