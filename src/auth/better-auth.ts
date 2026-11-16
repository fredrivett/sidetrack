import { and, eq, like, sql } from "drizzle-orm";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { username } from "better-auth/plugins";
import { users as authUsers, verifications } from "@/core/auth-schema";
import { getDb } from "@/core/db";
import { auditLog, meta, projects } from "@/core/schema";
import { notifySignup, sendPasswordResetEmail } from "@/lib/email";
import { SIGNUP_LOCK_KEY } from "./signup";
import { getEnv } from "@/lib/env";
import { normalizeWebUrl } from "@/lib/url";
import { isReservedUsername, USERNAME_RE } from "@/lib/username";

// Reading validated config here doubles as a backstop for the boot-time check
// in instrumentation.ts: if auth is imported via a path that bypasses
// instrumentation, getEnv() still throws an actionable error for a missing
// secret / BETTER_AUTH_URL rather than Better Auth's opaque lazy failure.
const env = getEnv();

const { db } = getDb();

// Username rules: 3–30 chars (the plugin also enforces its allowed charset of
// alphanumerics, underscores, and dots — notably no `-` or `/`, which keeps
// handles from ever colliding with item-ref separators). The validator runs
// against the normalized handle, so reserved-name checks are case-insensitive.
const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 30;

// Sign-up gate:
//   ALLOW_SIGNUP=true  → signup always enabled (open instance, intentional).
//   unset/anything else → first signup wins, then locked.
//
// The lock is enforced by a row in the `meta` table whose primary key
// guarantees atomicity: the `before` hook does INSERT OR FAIL on that row,
// so concurrent first-signup requests can't both pass the check (Better
// Auth runs hooks across async boundaries, which is what made the naive
// `userCount() === 0` check racey).
const ALLOW_SIGNUP = env.ALLOW_SIGNUP;
const ME_ADOPTION_KEY = "me_data_adopted";

function userCount(): number {
  try {
    return db.select({ id: authUsers.id }).from(authUsers).all().length;
  } catch {
    // Migrations may not have run yet on the very first boot.
    return 0;
  }
}

// Atomically claim a one-time sentinel row in `meta`. Returns true if this
// caller won the claim, false if it was already held (SQLite's PK constraint
// serializes concurrent inserts — exactly one wins). Real DB errors propagate
// rather than being silently treated as "already claimed".
function claimSentinel(key: string): boolean {
  try {
    // audit-exempt: sign-up lock bookkeeping in meta, not a user action.
    db.insert(meta).values({ key, value: "1" }).run();
    return true;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code?.startsWith("SQLITE_CONSTRAINT")) return false;
    throw error;
  }
}

// Reconcile the lock against actual user state at boot. Two situations to
// repair:
//   - No users + lock present: a prior signup claimed the sentinel then
//     died before writing the user row. Without this, the instance would
//     be permanently locked with no way in.
//   - Users + no lock: the lock was added after the first user existed
//     (e.g. operator flipped ALLOW_SIGNUP from true → false). Claim it now
//     so the next signup is correctly rejected.
try {
  const haveUsers = userCount() > 0;
  if (!haveUsers) {
    // audit-exempt: boot-time repair of the sign-up lock, not a user action.
    db.delete(meta).where(eq(meta.key, SIGNUP_LOCK_KEY)).run();
  } else {
    // Ensure the lock exists; claimSentinel ignores an existing one.
    claimSentinel(SIGNUP_LOCK_KEY);
  }
} catch {
  // Migrations may not have run yet on the very first boot.
}

// First-user adoption: the very first signup claims all pre-existing data
// stamped with the legacy 'me' placeholder. Subsequent signups don't —
// they start empty. Keeps the old single-user database intact on upgrade
// without any env-var configuration.
// audit-exempt: one-time hand-over of legacy single-user data to
// the first account, which also rewrites the old audit rows' actor.
function adoptMeRows(userId: string): void {
  const { changes: projectChanges } = db
    .update(projects)
    .set({ userId })
    .where(sql`${projects.userId} = 'me'`)
    .run();
  const { changes: auditChanges } = db
    .update(auditLog)
    .set({ actor: userId })
    .where(sql`${auditLog.actor} = 'me'`)
    .run();
  if (projectChanges || auditChanges) {
    console.log(
      `[auth] first user ${userId} adopted ${projectChanges} project(s) and ${auditChanges} audit row(s) from 'me'`,
    );
  }
}

// The avatar (`user.image`) is rendered as an <img> for everyone who shares a
// list with the user. Sign-up would store any image unchecked, so normalize it
// like setAvatarUrl does: blank clears it, a bare host gains https://, and
// anything that isn't an http(s) web address (javascript:, data:, typos) is
// rejected. Returns undefined when the write has no image.
function withNormalizedAvatar<T extends { image?: unknown }>(
  user: T,
): { data: T } | undefined {
  if (typeof user.image !== "string") return undefined;
  try {
    return { data: { ...user, image: normalizeWebUrl(user.image, "avatar URL") } };
  } catch {
    throw new APIError("BAD_REQUEST", {
      message: "Avatar must be an http(s) image URL.",
    });
  }
}

// Cancel every password reset link the user still holds.
// audit-exempt: Better Auth one-time tokens, not a user action; the password
// change this goes with is audited by the accounts trigger (migration 0021).
function revokeResetLinks(userId: string): void {
  db.delete(verifications)
    .where(
      and(
        like(verifications.identifier, "reset-password:%"),
        eq(verifications.value, userId),
      ),
    )
    .run();
}

// User fields people edit, which core owns and audits. `name` has no editor
// yet; it's blocked so a direct API call can't change it unaudited either.
const PROFILE_FIELDS = ["name", "image", "username", "displayUsername"] as const;

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "sqlite",
    usePlural: true,
    // better-sqlite3's transaction() is synchronous and rejects async
    // callbacks. Better Auth's adapter wraps ops in an async tx, so we let
    // it run sequentially instead. Risk window is small (auth flows write
    // 1–2 rows) and signup is idempotent enough.
    transaction: false,
  }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    // Delivery is environment-dependent (the local Mailpit catcher in dev,
    // Resend when configured, otherwise the link is logged to the server
    // console) — see src/lib/email.ts.
    // Better Auth answers "check your email" regardless of whether the
    // address exists, but this callback only runs for real accounts — so it
    // is deliberately NOT awaited: awaiting would let response latency (or a
    // failed send surfacing as a 500) reveal that the account exists.
    // Failures are logged for the operator instead.
    sendResetPassword: async ({ user, url }) => {
      void sendPasswordResetEmail({ to: user.email, url }).catch((error) => {
        console.error("[auth] failed to send password reset email:", error);
      });
    },
    // A reset usually means the old password (and any session it opened) can
    // no longer be trusted; sign everything out so the new password is the
    // only way in.
    revokeSessionsOnPasswordReset: true,
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          // Validate first: a bad avatar rejected after the claim below would
          // leave the instance locked with no user until the next boot.
          const normalized = withNormalizedAvatar(user);
          if (ALLOW_SIGNUP) return normalized;
          // First signup wins the lock; everyone after is rejected. A lost
          // claim (false) means it's already held → closed.
          if (!claimSentinel(SIGNUP_LOCK_KEY)) {
            throw new APIError("FORBIDDEN", {
              message: "Sign-up is closed on this instance.",
            });
          }
          return normalized;
        },
        after: async (user) => {
          // First-ever signup adopts legacy 'me' data. Gated by its own
          // atomic sentinel rather than userCount(), which races under
          // ALLOW_SIGNUP=true (concurrent first signups could both observe
          // count > 1 and skip adoption entirely). Exactly one signup wins
          // the claim and adopts, in either signup mode.
          if (claimSentinel(ME_ADOPTION_KEY)) adoptMeRows(user.id);
          // Not awaited: the notice must never slow or fail the signup.
          void notifySignup({
            name: user.name,
            email: user.email,
            username: typeof user.username === "string" ? user.username : null,
            userNumber: userCount(),
          });
        },
      },
      update: {
        // Profile changes go through core (setUsername, setAvatarUrl,
        // setUploadedAvatar), which audit them in the same transaction.
        // /update-user would write them with no audit row, so it may not
        // touch them. Better Auth's own updates (e.g. emailVerified) pass.
        before: async (user) => {
          if (PROFILE_FIELDS.some((field) => user[field] !== undefined)) {
            throw new APIError("BAD_REQUEST", {
              message: "Change your profile from the Profile page.",
            });
          }
        },
      },
    },
  },
  hooks: {
    // A signed-in password change clears the user's reset links before the
    // new password is written, so the accounts trigger (migration 0022)
    // never takes it for a reset. The trigger clears them after every change
    // anyway; this only has to run first. A failed attempt (wrong current
    // password) clears them too, which only the signed-in user can cause.
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/change-password") return;
      const session = await getSessionFromCtx(ctx);
      if (session) revokeResetLinks(session.user.id);
    }),
  },
  plugins: [
    username({
      minUsernameLength: USERNAME_MIN_LENGTH,
      maxUsernameLength: USERNAME_MAX_LENGTH,
      // A custom usernameValidator *replaces* the plugin's built-in charset
      // check (it's `options.usernameValidator || defaultValidator`), so we
      // must re-assert the allowed charset here — otherwise disallowed chars
      // like `-` or `/` (which would break the `username/ENG-42` ref qualifier)
      // would slip through. USERNAME_RE is the shared client/server source of
      // truth. Default validationOrder is pre-normalization, so the value may
      // still be mixed-case; isReservedUsername lowercases internally.
      usernameValidator: (value) =>
        USERNAME_RE.test(value) && !isReservedUsername(value),
    }),
    // nextCookies must stay last so it can attach Set-Cookie headers after
    // every other plugin's response hooks have run.
    nextCookies(),
  ],
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
});
