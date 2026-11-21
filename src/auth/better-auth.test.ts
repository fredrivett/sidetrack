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

import { describeEvent, namesFor, plainText } from "@/core/describe";
import type { ChangeEvent } from "@/core/events";
import { totpCode } from "./totp.test-helper";

type Auth = (typeof import("./better-auth"))["auth"];
let auth: Auth;
let sqlite: import("better-sqlite3").Database;
let getDbModule: typeof import("@/core/db");

beforeAll(async () => {
  const { runMigrations } = await import("@/core/migrate");
  runMigrations();
  getDbModule = await import("@/core/db");
  sqlite = getDbModule.getDb().sqlite;
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

// What the trigger recorded for each change, in the words Activity shows.
const passwordLog = (userId: string) =>
  (
    sqlite
      .prepare(
        "select json_extract(event, '$.viaReset') as viaReset from audit_log where entity_type = 'profile' and json_extract(event, '$.type') = 'profile.password' and actor = ? order by rowid",
      )
      .all(userId) as { viaReset: 0 | 1 }[]
  ).map((r) => (r.viaReset ? "reset password with an emailed link" : "changed password"));

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
    expect(passwordLog(alice)).toEqual(["reset password with an emailed link"]);
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
    expect(passwordLog(alice)).toEqual(["reset password with an emailed link", "changed password"]);
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
    expect(passwordLog(bob)).toEqual(["reset password with an emailed link"]);
  });
});

describe("two-factor sign-in", () => {
  /** The cookies a response set, as a Cookie header for the next request,
   * on top of `jar` (the browser's cookies so far). Expired ones drop out. */
  function withCookies(jar: Headers, set: Headers) {
    const cookies = new Map(
      (jar.get("cookie") ?? "")
        .split("; ")
        .filter(Boolean)
        .map((c) => c.split("=") as [string, string]),
    );
    for (const line of set.getSetCookie()) {
      const [pair, ...attrs] = line.split("; ");
      const [name, value] = pair.split("=");
      if (!value || attrs.some((a) => /^max-age=0$/i.test(a))) cookies.delete(name);
      else cookies.set(name, value);
    }
    return new Headers({ cookie: [...cookies].map(([n, v]) => `${n}=${v}`).join("; ") });
  }

  /** Signs in with the password; whether it asked for a second step, and the
   * browser's cookies after. */
  async function passwordStep(name: string, password: string, jar = new Headers()) {
    const { headers, response } = await auth.api.signInEmail({
      body: { email: `${name}@example.com`, password },
      headers: jar,
      returnHeaders: true,
    });
    return { asked: "twoFactorRedirect" in response, jar: withCookies(jar, headers) };
  }

  const hasSession = (jar: Headers) => /better-auth\.session_token=/.test(jar.get("cookie") ?? "");

  // What the triggers logged, in the words Activity shows.
  const twoFactorLog = (userId: string) =>
    (
      sqlite
        .prepare(
          "select event from audit_log where actor = ? and json_extract(event, '$.type') in ('profile.two_factor', 'profile.backup_codes') order by rowid",
        )
        .all(userId) as { event: string }[]
    ).map(({ event }) => {
      const parsed = JSON.parse(event) as ChangeEvent;
      const { db } = getDbModule.getDb();
      return plainText(describeEvent(parsed, namesFor(db, [parsed], userId)));
    });

  const rows = (sql: string, userId: string) =>
    (sqlite.prepare(sql).get(userId) as { n: number }).n;

  it("asks for a code after the password once set up, and logs every change", async () => {
    const carol = await signUp("carol");
    const password = "first-pass-1";
    let { jar } = await passwordStep("carol", password);

    // Started but not verified: sign-in doesn't ask yet.
    const { totpURI, backupCodes } = await auth.api.enableTwoFactor({ body: { password }, headers: jar });
    expect(backupCodes).toHaveLength(10);
    expect((await passwordStep("carol", password)).asked).toBe(false);

    // A wrong code turns nothing on; the app's code does.
    await expect(auth.api.verifyTOTP({ body: { code: "000000" }, headers: jar })).rejects.toThrow();
    expect(twoFactorLog(carol)).toEqual([]);
    const verified = await auth.api.verifyTOTP({
      body: { code: totpCode(totpURI) },
      headers: jar,
      returnHeaders: true,
    });
    jar = withCookies(jar, verified.headers);
    expect(twoFactorLog(carol)).toEqual(["turned on two-factor sign-in"]);

    // Enabling again would swap the secret unverified: refused.
    await expect(auth.api.enableTwoFactor({ body: { password }, headers: jar })).rejects.toThrow(
      /already on/,
    );

    // The password alone signs nobody in now.
    const pending = await passwordStep("carol", password);
    expect(pending.asked).toBe(true);
    expect(hasSession(pending.jar)).toBe(false);
    await expect(
      auth.api.verifyTOTP({ body: { code: "000000" }, headers: pending.jar }),
    ).rejects.toThrow();
    const signedIn = await auth.api.verifyTOTP({
      body: { code: totpCode(totpURI) },
      headers: pending.jar,
      returnHeaders: true,
    });
    expect(hasSession(withCookies(pending.jar, signedIn.headers))).toBe(true);

    // A backup code signs in once, and can trust the device.
    const lost = await passwordStep("carol", password);
    const trusted = await auth.api.verifyBackupCode({
      body: { code: backupCodes[0], trustDevice: true },
      headers: lost.jar,
      returnHeaders: true,
    });
    const device = withCookies(lost.jar, trusted.headers);
    expect(hasSession(device)).toBe(true);
    expect(twoFactorLog(carol)).toEqual([
      "turned on two-factor sign-in",
      "used a backup code",
    ]);
    const again = await passwordStep("carol", password);
    await expect(
      auth.api.verifyBackupCode({ body: { code: backupCodes[0] }, headers: again.jar }),
    ).rejects.toThrow();

    // The trusted device skips the code; another doesn't.
    expect((await passwordStep("carol", password, device)).asked).toBe(false);
    expect((await passwordStep("carol", password)).asked).toBe(true);

    // New codes replace the old ones.
    const fresh = await auth.api.generateBackupCodes({ body: { password }, headers: jar });
    expect(fresh.backupCodes).not.toContain(backupCodes[1]);
    const old = await passwordStep("carol", password);
    await expect(
      auth.api.verifyBackupCode({ body: { code: backupCodes[1] }, headers: old.jar }),
    ).rejects.toThrow();

    // Turning it off removes the secret and forgets trusted devices.
    await auth.api.disableTwoFactor({ body: { password }, headers: jar });
    expect(twoFactorLog(carol)).toEqual([
      "turned on two-factor sign-in",
      "used a backup code",
      "generated new backup codes",
      "turned off two-factor sign-in",
    ]);
    expect(rows("select count(*) as n from two_factors where user_id = ?", carol)).toBe(0);
    expect(
      rows(
        "select count(*) as n from verifications where identifier like 'trust-device-%' and value = ?",
        carol,
      ),
    ).toBe(0);
    expect((await passwordStep("carol", password)).asked).toBe(false);
  });
});
