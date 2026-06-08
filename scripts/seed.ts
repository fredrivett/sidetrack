/**
 * Seed a fresh database with demo users and sample data.
 *
 * Intended for NON-persistent environments only — local dev and ephemeral
 * preview deploys — so the app isn't an empty shell on first run. Guarded
 * three ways so it can never touch real data:
 *   1. Runs only when SIDETRACK_SEED=true (production/staging never set it).
 *   2. Seeds only a fresh DB (no users) — re-runs are a no-op.
 *   3. Only ever INSERTs; never updates or deletes.
 *
 * Users are created through Better Auth's normal signup, so they're real
 * loginable accounts. Each user owns their own projects — there's no project
 * sharing yet (single-owner model), so a user only sees their own board.
 */
import { users } from "@/core/auth-schema";
import { getDb } from "@/core/db";
import { addItem, completeItem } from "@/core/items";
import { runMigrations } from "@/core/migrate";
import { linkItemToPr } from "@/core/prLinks";
import { createProject } from "@/core/projects";
import type { ItemKind, ProjectStatus } from "@/core/schema";

// Seeded rows look like the owner created them in the web UI.
const SOURCE = "web" as const;

interface SeedItem {
  kind: ItemKind;
  title: string;
  category?: string;
  done?: boolean;
  pr?: string;
}
interface SeedProject {
  name: string;
  status: ProjectStatus;
  items: SeedItem[];
}
interface SeedUser {
  email: string;
  name: string;
  projects: SeedProject[];
}

function plan(): SeedUser[] {
  const primaryEmail = process.env.SEED_EMAIL ?? "demo@sidetrack.local";
  return [
    {
      email: primaryEmail,
      name: "Demo User",
      projects: [
        {
          name: "Sidetrack",
          status: "launched",
          items: [
            { kind: "milestone", title: "v1.0 launched" },
            {
              kind: "task",
              title: "Set up error tracking",
              category: "infra",
              done: true,
              pr: "https://github.com/fredrivett/sidetrack/pull/1",
            },
            { kind: "task", title: "Write the launch post", category: "growth" },
            { kind: "task", title: "Triage early feedback", category: "growth" },
          ],
        },
        {
          name: "Mobile app",
          status: "early-access",
          items: [
            { kind: "task", title: "Cut a TestFlight build" },
            { kind: "task", title: "Wire push notifications" },
            { kind: "milestone", title: "Public beta" },
          ],
        },
      ],
    },
    {
      email: "alex@sidetrack.local",
      name: "Alex Rivera",
      projects: [
        {
          name: "Personal site",
          status: "launched",
          items: [
            { kind: "task", title: "Ship the about page", done: true },
            { kind: "task", title: "Add a now page" },
          ],
        },
        {
          name: "Newsletter",
          status: "idea",
          items: [
            { kind: "task", title: "Pick a sending platform" },
            { kind: "task", title: "Draft issue #1" },
          ],
        },
      ],
    },
  ];
}

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

  // The signup gate locks after the first user, which would reject the second
  // demo signup. Open it for the seed run only. Must be set before
  // better-auth.ts is imported (it reads ALLOW_SIGNUP at module load), hence
  // the dynamic import below.
  process.env.ALLOW_SIGNUP = "true";
  const { auth } = await import("@/auth/better-auth");

  const password = process.env.SEED_PASSWORD ?? "sidetrack-demo";

  for (const u of plan()) {
    const { user } = await auth.api.signUpEmail({
      body: { email: u.email, password, name: u.name },
    });
    for (const proj of u.projects) {
      const project = createProject(
        db,
        user.id,
        { name: proj.name, status: proj.status },
        SOURCE,
      );
      for (const item of proj.items) {
        const created = addItem(
          db,
          user.id,
          {
            projectId: project.id,
            kind: item.kind,
            title: item.title,
            category: item.category,
          },
          SOURCE,
        );
        if (item.done) completeItem(db, user.id, created.id, SOURCE);
        if (item.pr) linkItemToPr(db, user.id, created.id, item.pr, SOURCE);
      }
    }
  }

  const emails = plan()
    .map((u) => u.email)
    .join(", ");
  console.log(
    `[seed] seeded ${plan().length} users (${emails}), each with the password "${password}".`,
  );
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[seed] failed:", err);
    process.exit(1);
  });
