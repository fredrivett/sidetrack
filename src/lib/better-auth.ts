import { eq, sql } from "drizzle-orm";
import { APIError } from "better-auth/api";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { users as authUsers } from "@/core/auth-schema";
import { getDb } from "@/core/db";
import { auditLog, meta, projects } from "@/core/schema";

const { db } = getDb();

// Sign-up gate:
//   ALLOW_SIGNUP=true  → signup always enabled (open instance, intentional).
//   unset/anything else → first signup wins, then locked.
//
// The lock is enforced by a row in the `meta` table whose primary key
// guarantees atomicity: the `before` hook does INSERT OR FAIL on that row,
// so concurrent first-signup requests can't both pass the check (Better
// Auth runs hooks across async boundaries, which is what made the naive
// `userCount() === 0` check racey).
const ALLOW_SIGNUP = process.env.ALLOW_SIGNUP === "true";
const SIGNUP_LOCK_KEY = "signups_first_claimed";

function userCount(): number {
  try {
    return db.select({ id: authUsers.id }).from(authUsers).all().length;
  } catch {
    // Migrations may not have run yet on the very first boot.
    return 0;
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
    db.delete(meta).where(eq(meta.key, SIGNUP_LOCK_KEY)).run();
  } else {
    try {
      db.insert(meta)
        .values({ key: SIGNUP_LOCK_KEY, value: "1" })
        .run();
    } catch {
      // Lock already present — fine, leave it.
    }
  }
} catch {
  // Migrations may not have run yet on the very first boot.
}

// First-user adoption: the very first signup claims all pre-existing data
// stamped with the legacy 'me' placeholder. Subsequent signups don't —
// they start empty. Keeps the old single-user database intact on upgrade
// without any env-var configuration.
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
  },
  databaseHooks: {
    user: {
      create: {
        before: async () => {
          if (ALLOW_SIGNUP) return;
          // Atomic claim: SQLite's PK constraint on meta.key serializes
          // concurrent inserts — exactly one survives, everyone else gets a
          // CONSTRAINT error. No userCount() race.
          try {
            db.insert(meta)
              .values({ key: SIGNUP_LOCK_KEY, value: "1" })
              .run();
          } catch {
            throw new APIError("FORBIDDEN", {
              message: "Sign-up is closed on this instance.",
            });
          }
        },
        after: async (user) => {
          // Race-free with the sentinel gate above: only one signup can
          // reach here when ALLOW_SIGNUP is unset, so count === 1 reliably
          // identifies the first-ever user.
          if (userCount() === 1) adoptMeRows(user.id);
        },
      },
    },
  },
  plugins: [nextCookies()],
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
});
