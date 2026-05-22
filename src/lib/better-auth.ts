import { sql } from "drizzle-orm";
import { APIError } from "better-auth/api";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { users as authUsers } from "@/core/auth-schema";
import { getDb } from "@/core/db";
import { auditLog, projects } from "@/core/schema";

const { db } = getDb();

// Sign-up gate:
//   ALLOW_SIGNUP=true  → signup always enabled (open instance, intentional).
//   unset/anything else → first signup wins, then locked. Subsequent signups
//                         are rejected at the database hook layer, evaluated
//                         per request so the lock takes effect immediately
//                         (no server restart needed).
//   Self-hosters who want to add more users later flip ALLOW_SIGNUP=true
//   and restart.
const ALLOW_SIGNUP = process.env.ALLOW_SIGNUP === "true";

function userCount(): number {
  try {
    return db.select({ id: authUsers.id }).from(authUsers).all().length;
  } catch {
    // Migrations may not have run yet on the very first boot.
    return 0;
  }
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
          if (userCount() > 0) {
            throw new APIError("FORBIDDEN", {
              message: "Sign-up is closed on this instance.",
            });
          }
        },
        after: async (user) => {
          // The user has just been written. If they were the first ever
          // (count === 1 now), adopt any legacy 'me' rows. Otherwise no-op.
          if (userCount() === 1) adoptMeRows(user.id);
        },
      },
    },
  },
  plugins: [nextCookies()],
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
});
