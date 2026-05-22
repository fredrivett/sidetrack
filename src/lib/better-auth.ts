import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { users as authUsers } from "@/core/auth-schema";
import { getDb } from "@/core/db";

const { db } = getDb();

// Sign-up gate, evaluated once at server start.
//   ALLOW_SIGNUP=true  → signup always enabled (open instance, intentional).
//   unset/anything else → first signup wins, then locked. Self-hosters who
//                         want to add more users later flip ALLOW_SIGNUP=true
//                         and restart.
// The "boot-time only" check has one fuzzy edge: between the first signup
// and the next restart, signup stays open. Acceptable for a single-admin
// self-host model; tighter gating would mean per-request DB lookups.
const ALLOW_SIGNUP = process.env.ALLOW_SIGNUP === "true";

function hasAnyUser(): boolean {
  try {
    const row = db.select({ id: authUsers.id }).from(authUsers).limit(1).get();
    return !!row;
  } catch {
    // Migrations may not have run yet on the very first boot.
    return false;
  }
}

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "sqlite",
    usePlural: true,
    transaction: true,
  }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    disableSignUp: !ALLOW_SIGNUP && hasAnyUser(),
  },
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
});
