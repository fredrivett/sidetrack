/**
 * Seed a fresh database with a loginable demo user and sample data.
 *
 * Intended for NON-persistent environments only — local dev and ephemeral
 * preview deploys — so the app isn't an empty shell on first run. Guarded
 * three ways so it can never touch real data:
 *   1. Runs only when SIDETRACK_SEED=true (production/staging never set it).
 *   2. Seeds only a fresh DB (no users) — re-runs are a no-op.
 *   3. Only ever INSERTs; never updates or deletes.
 *
 * The demo user is created through Better Auth's normal signup, so it's a
 * real loginable account and goes through the first-user gate + 'me'
 * adoption hooks exactly like a human signup would.
 */
import { auth } from "@/auth/better-auth";
import { users } from "@/core/auth-schema";
import { getDb } from "@/core/db";
import { addItem, completeItem } from "@/core/items";
import { runMigrations } from "@/core/migrate";
import { linkItemToPr } from "@/core/prLinks";
import { createProject } from "@/core/projects";

// Seeded rows look like the demo user created them in the web UI.
const SOURCE = "web" as const;

async function seed() {
  if (process.env.SIDETRACK_SEED !== "true") {
    console.log(
      "[seed] SIDETRACK_SEED is not 'true' — skipping (persistent environment).",
    );
    return;
  }

  runMigrations();
  const { db } = getDb();

  // Only seed a fresh DB. Any existing user (demo or real) means this
  // instance is already initialised, so re-running is a safe no-op.
  const existing = db.select({ id: users.id }).from(users).limit(1).get();
  if (existing) {
    console.log("[seed] database already has a user — nothing to do.");
    return;
  }

  const email = process.env.SEED_EMAIL ?? "demo@sidetrack.local";
  const password = process.env.SEED_PASSWORD ?? "sidetrack-demo";

  const { user } = await auth.api.signUpEmail({
    body: { email, password, name: "Demo User" },
  });
  const uid = user.id;

  // Project 1 — a launched project with completed work and a PR link.
  const sidetrack = createProject(db, uid, { name: "Sidetrack", status: "launched" }, SOURCE);
  addItem(db, uid, { projectId: sidetrack.id, kind: "milestone", title: "v1.0 launched" }, SOURCE);
  const errors = addItem(
    db,
    uid,
    { projectId: sidetrack.id, kind: "task", title: "Set up error tracking", category: "infra" },
    SOURCE,
  );
  completeItem(db, uid, errors.id, SOURCE);
  addItem(
    db,
    uid,
    { projectId: sidetrack.id, kind: "task", title: "Write the launch post", category: "growth" },
    SOURCE,
  );
  addItem(
    db,
    uid,
    { projectId: sidetrack.id, kind: "task", title: "Triage early feedback", category: "growth" },
    SOURCE,
  );
  linkItemToPr(
    db,
    uid,
    errors.id,
    "https://github.com/fredrivett/sidetrack/pull/1",
    SOURCE,
  );

  // Project 2 — mid-flight, in early access.
  const mobile = createProject(db, uid, { name: "Mobile app", status: "early-access" }, SOURCE);
  addItem(db, uid, { projectId: mobile.id, kind: "task", title: "Cut a TestFlight build" }, SOURCE);
  addItem(db, uid, { projectId: mobile.id, kind: "task", title: "Wire push notifications" }, SOURCE);
  addItem(db, uid, { projectId: mobile.id, kind: "milestone", title: "Public beta" }, SOURCE);

  // Project 3 — just an idea.
  const blog = createProject(db, uid, { name: "Blog", status: "idea" }, SOURCE);
  addItem(db, uid, { projectId: blog.id, kind: "task", title: "Pick a static site generator" }, SOURCE);
  addItem(db, uid, { projectId: blog.id, kind: "task", title: "Draft the first post" }, SOURCE);

  console.log(`[seed] seeded demo data. Log in with ${email} / ${password}`);
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[seed] failed:", err);
    process.exit(1);
  });
