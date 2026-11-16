import { beforeAll, describe, expect, it, vi } from "vitest";

// The real Better Auth instance on a fresh in-memory DB, so password resets
// and changes run through Better Auth's own endpoints. The audit trigger's
// "via a reset link" label and the /change-password hook both depend on the
// order Better Auth reads, writes and deletes reset links in, which an
// upgrade could change.
const mail = vi.hoisted(() => {
  process.env.DB_PATH = ":memory:";
  process.env.ALLOW_SIGNUP = "true";
  process.env.BETTER_AUTH_SECRET = "test-secret-for-the-better-auth-suite-0123456789";
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
  return { resetUrls: [] as string[] };
});
vi.mock("@/lib/email", () => ({
  sendPasswordResetEmail: async ({ url }: { url: string }) => {
    mail.resetUrls.push(url);
  },
  notifySignup: async () => {},
}));

type Auth = (typeof import("./better-auth"))["auth"];
let auth: Auth;
let sqlite: import("better-sqlite3").Database;

beforeAll(async () => {
  const { runMigrations } = await import("@/core/migrate");
  runMigrations();
  sqlite = (await import("@/core/db")).getDb().sqlite;
  ({ auth } = await import("./better-auth"));
});

async function signUp(name: string) {
  const { user } = await auth.api.signUpEmail({
    body: { email: `${name}@example.com`, password: "first-pass-1", name, username: name },
  });
  return user.id;
}

/** Ask for a reset email and return the token its link carries. */
async function requestReset(name: string) {
  await auth.api.requestPasswordReset({
    body: { email: `${name}@example.com`, redirectTo: "/reset-password" },
  });
  const url = mail.resetUrls.at(-1) ?? "";
  const token = /reset-password\/([^?]+)/.exec(url)?.[1];
  if (!token) throw new Error(`no token in ${url}`);
  return token;
}

/** Headers carrying a fresh session cookie for the user. */
async function signIn(name: string, password: string) {
  const { headers } = await auth.api.signInEmail({
    body: { email: `${name}@example.com`, password },
    returnHeaders: true,
  });
  const cookie = (headers.get("set-cookie") ?? "").split(";")[0];
  return new Headers({ cookie });
}

const passwordLog = (userId: string) =>
  (
    sqlite
      .prepare(
        "select detail from audit_log where entity_type = 'profile' and actor = ? order by rowid",
      )
      .all(userId) as { detail: string }[]
  ).map((r) => r.detail);

const resetLinkHolders = () =>
  (
    sqlite
      .prepare("select value from verifications where identifier like 'reset-password:%'")
      .all() as { value: string }[]
  ).map((r) => r.value);

describe("password resets and changes", () => {
  it("label resets and changes exactly, and cancel only that user's pending reset links", async () => {
    const alice = await signUp("alice");
    const bob = await signUp("bob");
    const bobsLink = await requestReset("bob");

    // A reset with one of two links sent: labelled a reset, the other link dies.
    const first = await requestReset("alice");
    const second = await requestReset("alice");
    await auth.api.resetPassword({ body: { token: first, newPassword: "reset-pass-2" } });
    expect(passwordLog(alice)).toEqual(["password via a reset link"]);
    await expect(
      auth.api.resetPassword({ body: { token: second, newPassword: "hijack-pass-3" } }),
    ).rejects.toThrow();
    expect(resetLinkHolders()).toEqual([bob]);

    // A signed-in change with a link pending: an ordinary change, link dies.
    const pending = await requestReset("alice");
    const headers = await signIn("alice", "reset-pass-2");
    await auth.api.changePassword({
      body: { currentPassword: "reset-pass-2", newPassword: "changed-pass-4" },
      headers,
    });
    expect(passwordLog(alice)).toEqual(["password via a reset link", "password"]);
    await expect(
      auth.api.resetPassword({ body: { token: pending, newPassword: "hijack-pass-5" } }),
    ).rejects.toThrow();

    // A wrong current password changes and logs nothing, but still cancels.
    const another = await requestReset("alice");
    const again = await signIn("alice", "changed-pass-4");
    await expect(
      auth.api.changePassword({
        body: { currentPassword: "wrong-pass", newPassword: "never-pass-6" },
        headers: again,
      }),
    ).rejects.toThrow();
    expect(passwordLog(alice)).toHaveLength(2);
    expect(resetLinkHolders()).not.toContain(alice);
    await expect(
      auth.api.resetPassword({ body: { token: another, newPassword: "hijack-pass-7" } }),
    ).rejects.toThrow();

    // Bob's link, untouched throughout, still works.
    await auth.api.resetPassword({ body: { token: bobsLink, newPassword: "bob-pass-2" } });
    expect(passwordLog(bob)).toEqual(["password via a reset link"]);
  });
});
