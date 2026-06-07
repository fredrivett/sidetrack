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

1. Create a `.env` file alongside `docker-compose.yml` with two access tokens:

   ```bash
   WEB_TOKEN=...   # gates the web UI
   MCP_TOKEN=...   # gates the MCP server
   ```

   Generate strong values for each with `openssl rand -hex 32`.

2. Start it:

   ```bash
   docker compose up -d
   ```

Sidetrack is now running at [http://localhost:3000](http://localhost:3000).
Migrations run automatically on startup, and your data persists in the
`sidetrack-data` volume.

## Configuration

Sidetrack is configured with environment variables, read the same way whether
you run it via Docker or locally. Set them in `.env` for Docker Compose, or
`.env.local` for local development.

**Required** — the two access tokens (the only configuration most users need):

| Variable | Description |
| --- | --- |
| `WEB_TOKEN` | Gates access to the web UI |
| `MCP_TOKEN` | Gates access to the MCP server |

**Optional** — override where data is stored. The Docker image already sets
these to `/data`, so self-hosters can ignore them:

| Variable | Default (local) | Description |
| --- | --- | --- |
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

The MCP server is exposed at `/mcp` and authenticates with `MCP_TOKEN`. Point an
MCP-capable client (e.g. Claude) at it to list, create, and update projects and
items. Web requests are tagged `web` and MCP requests `mcp` in the audit log, so
you always know what changed and through which interface.

## Development

To run Sidetrack locally to make changes, you'll need
[Node.js](https://nodejs.org) and [pnpm](https://pnpm.io).

```bash
pnpm install
```

Add `WEB_TOKEN` and `MCP_TOKEN` to `.env.local` (any random strings), then start
the dev server:

```bash
pnpm dev
```

The app starts at [http://localhost:3000](http://localhost:3000), creating a
SQLite database at `./data/sidetrack.db` and running migrations automatically.

After changing the schema in `src/core/schema.ts`, generate a migration with
`pnpm db:generate` (it's then applied on the next startup).

| Command | Description |
| --- | --- |
| `pnpm dev` | Start the development server |
| `pnpm build` | Production build |
| `pnpm start` | Serve the production build |
| `pnpm lint` | Run ESLint |
| `pnpm db:generate` | Generate Drizzle migrations from schema changes |
| `pnpm db:migrate` | Apply pending migrations manually |

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
