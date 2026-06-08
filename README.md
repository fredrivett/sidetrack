# Sidetrack

Sidetrack is an agent-first, self-hostable side-project tracker. Designed for
simplicity and to work where you're already working.

- 🤖 **Agent first** — a built-in [Model Context Protocol](https://modelcontextprotocol.io) server so AI agents can read and update your projects
- 🖥️ **Web UI** for everyday use
- 📁 **Projects → items → categories**, with drag-to-reorder
- 📜 **Audit log** — every change recorded, web or agent
- 📱 **Installable** as an iOS PWA

## Quick start (Docker)

The easiest way to run Sidetrack is with [Docker](https://docs.docker.com/get-docker/)
and Docker Compose.

1. Create a `.env` file alongside `docker-compose.yml`:

   ```bash
   BETTER_AUTH_SECRET=...                  # signs session cookies
   BETTER_AUTH_URL=http://localhost:3000   # the URL you serve from
   ```

   Generate the secret with `openssl rand -hex 32`. Set `BETTER_AUTH_URL`
   to the public URL you actually reach the app at — the session cookie's
   attributes depend on it.

2. Start it:

   ```bash
   docker compose up -d
   ```

Sidetrack is now running at [http://localhost:3000](http://localhost:3000).
Migrations run automatically on startup, and your data persists in the
`sidetrack-data` volume. Open the app and sign up — after the first signup,
registration locks automatically (see `ALLOW_SIGNUP` to keep it open).

## Configuration

Sidetrack is configured with environment variables, read the same way whether
you run it via Docker or locally. Set them in `.env` for Docker Compose, or
`.env.local` for local development.

**Required** — authentication (the only configuration most users need):

| Variable | Description |
| --- | --- |
| `BETTER_AUTH_SECRET` | Signs session cookies. Generate with `openssl rand -hex 32` |
| `BETTER_AUTH_URL` | The public URL you serve from (e.g. `https://sidetrack.example.com`) |

Accounts are managed in-app with email + password. The **first** person to
sign up claims the instance; after that, registration is locked.

**Optional** — registration and data location. The Docker image already sets
the data paths to `/data`, so self-hosters can ignore those:

| Variable | Default | Description |
| --- | --- | --- |
| `ALLOW_SIGNUP` | `false` | `true` keeps signup open after the first user (multi-tenant instances) |
| `SIDETRACK_SEED` | `false` | `true` seeds a fresh DB with a demo user + sample data. For ephemeral envs (local, previews) only — never set it in production/staging |
| `DB_PATH` | `./data/sidetrack.db` | SQLite database path |
| `BACKUP_DIR` | `./data/backups` | Where periodic backups are written |

In Docker, `/data` is mounted as a persistent volume. Any host with a
persistent filesystem works (e.g. a VPS or Railway); SQLite rules out serverless
platforms without durable disk.

**Optional** — analytics and error tracking via [PostHog](https://posthog.com).
Entirely opt-in: with no keys set, nothing is sent anywhere. There are two
independent halves:

| Variable | Default | Description |
| --- | --- | --- |
| `POSTHOG_KEY` | _(unset)_ | Server key for server-side error tracking. Read at runtime |
| `NEXT_PUBLIC_POSTHOG_KEY` | _(unset)_ | Client key for pageviews, autocapture, and client-side errors |
| `POSTHOG_HOST` / `NEXT_PUBLIC_POSTHOG_HOST` | `https://us.i.posthog.com` | Ingestion host (use `https://eu.i.posthog.com` for EU Cloud) |

`POSTHOG_KEY` is read at runtime, so it never enters the build output. The
`NEXT_PUBLIC_` key, however, is **inlined into the client bundle at build
time** — that is how all browser analytics work. Building from source without
it (the default `docker compose up`) ships zero analytics. **Do not bake a
`NEXT_PUBLIC_POSTHOG_KEY` into a published/prebuilt image**, or every instance
running that image would report into your PostHog project.

The following are **build-time only** and used for tying errors back to the
commit that shipped them. They are entirely optional; without them a build is
unaffected. They power the hosted deploy and are not needed for self-hosting.

| Variable | Default | Description |
| --- | --- | --- |
| `SOURCE_COMMIT` | `$GITHUB_SHA` | Commit SHA, inlined as `NEXT_PUBLIC_RELEASE` and tagged onto every PostHog capture |
| `POSTHOG_API_KEY` | _(unset)_ | Personal API key. When set with `POSTHOG_PROJECT_ID`, `next build` uploads source maps to PostHog (and deletes them after) so stack traces symbolicate |
| `POSTHOG_PROJECT_ID` | _(unset)_ | PostHog project id for the source-map upload |
| `POSTHOG_API_HOST` | `https://us.posthog.com` | API host for the upload (note: not the `us.i.` ingestion host) |

## Connecting an MCP client

The MCP server is exposed at `/mcp` and authenticates with a personal API key.
Mint one from **Account → API keys** in the web UI (the plaintext is shown
once — copy it then), and pass it either way:

```bash
# Authorization header — curl, Claude Desktop, scripts
curl -X POST https://your-host/mcp \
  -H "Authorization: Bearer sk_…" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# ?key= query param — claude.ai custom connectors, which can't set a
# custom header, so the key rides in the URL
https://your-host/mcp?key=sk_…
```

Point an MCP-capable client (e.g. Claude) at it to list, create, and update
projects and items. Web requests are tagged `web` and MCP requests `mcp` in
the audit log, so you always know what changed and through which interface.
Keys are scoped to the user who minted them; revoke them from the same page.

## Development

To run Sidetrack locally to make changes, you'll need
[Node.js](https://nodejs.org) and [pnpm](https://pnpm.io).

```bash
pnpm install
```

Add an auth secret to `.env.local`, then start the dev server:

```bash
echo "BETTER_AUTH_SECRET=$(openssl rand -hex 32)" >> .env.local
pnpm dev
```

The app starts at [http://localhost:3000](http://localhost:3000), creating a
SQLite database at `./data/sidetrack.db` and running migrations automatically.
`BETTER_AUTH_URL` is optional locally — Better Auth infers the origin from each
request, which also keeps things working when the dev server runs on a
non-default port (e.g. one per git worktree). Set it only for a fixed
deployment origin.

To start with a populated board instead of an empty one, seed a fresh DB with
a demo user and sample projects:

```bash
SIDETRACK_SEED=true pnpm db:seed   # then log in as demo@sidetrack.local / sidetrack-demo
```

After changing the schema in `src/core/schema.ts`, generate a migration with
`pnpm db:generate` (it's then applied on the next startup).

| Command | Description |
| --- | --- |
| `pnpm dev` | Start the development server |
| `pnpm build` | Production build |
| `pnpm start` | Serve the production build |
| `pnpm lint` | Run ESLint |
| `pnpm test` | Run the Vitest suite |
| `pnpm db:generate` | Generate Drizzle migrations from schema changes |
| `pnpm db:migrate` | Apply pending migrations manually |
| `pnpm db:seed` | Seed a fresh DB with demo data (needs `SIDETRACK_SEED=true`) |

Built with [Next.js 16](https://nextjs.org), [React 19](https://react.dev),
[SQLite](https://www.sqlite.org) via
[better-sqlite3](https://github.com/WiseLibs/better-sqlite3) and
[Drizzle ORM](https://orm.drizzle.team),
[Tailwind CSS v4](https://tailwindcss.com) with
[shadcn/ui](https://ui.shadcn.com) and [Base UI](https://base-ui.com), and
[dnd-kit](https://dndkit.com) for drag-to-reorder.

## License

Sidetrack is [Fair Source](https://fair.io) software, licensed under the
[Functional Source License, Version 1.1, Apache 2.0 Future License (FSL-1.1-ALv2)](./LICENSE.md).
Copyright © 2026 Jotmake Limited.

In short:

- You may use, copy, modify, and redistribute the code for **any purpose except
  a Competing Use** — broadly, a commercial product or service that substitutes
  for Sidetrack. Internal use, education, research, and contributions back are
  all explicitly permitted.
- Each released version **automatically converts to the
  [Apache License, Version 2.0](https://www.apache.org/licenses/LICENSE-2.0) two
  years after its release**, at which point all restrictions fall away.

This is a source-available license, not an OSI-approved "open source" license,
during the two-year window. See [`LICENSE.md`](./LICENSE.md) for the full terms.
