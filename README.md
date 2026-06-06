# Sidetrack

Sidetrack is a self-hostable side-project tracker.

- 🤖 **MCP first** — a built-in [Model Context Protocol](https://modelcontextprotocol.io) server so AI agents can read and update your projects
- 🖥️ **Web UI** for everyday use
- 📁 **Projects → items → categories**, with drag-to-reorder
- 📜 **Audit log** — every change recorded, web or agent
- 📱 **Installable** as an iOS PWA

## Stack

- **[Next.js 16](https://nextjs.org)** (App Router) + **React 19**
- **SQLite** via [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) and [Drizzle ORM](https://orm.drizzle.team)
- **[Tailwind CSS v4](https://tailwindcss.com)** with [shadcn/ui](https://ui.shadcn.com) and [Base UI](https://base-ui.com)
- **[dnd-kit](https://dndkit.com)** + [fractional indexing](https://github.com/rocicorp/fractional-indexing) for drag-to-reorder
- **[MCP](https://modelcontextprotocol.io)** server via [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk)

## Getting started

Requires Node.js and [pnpm](https://pnpm.io).

```bash
pnpm install
```

Create a `.env.local` with the two access tokens (any sufficiently random
strings):

```bash
WEB_TOKEN=...   # gates access to the web UI
MCP_TOKEN=...   # gates access to the MCP server
```

Set up the database and start the dev server:

```bash
pnpm db:migrate   # apply migrations
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Start the development server |
| `pnpm build` | Production build |
| `pnpm start` | Serve the production build |
| `pnpm lint` | Run ESLint |
| `pnpm db:generate` | Generate Drizzle migrations from schema changes |
| `pnpm db:migrate` | Apply pending migrations |

## MCP server

The MCP server is exposed at `/mcp` and authenticates with `MCP_TOKEN`. Point an
MCP-capable client (e.g. Claude) at it to list, create, and update projects and
items. Web requests are tagged `web` and MCP requests `mcp` in the audit log, so
you always know what changed and through which interface.

## Deployment

A `Dockerfile` and `docker-compose.yml` are included for self-hosting. The app
also deploys to [Vercel](https://vercel.com); note the SQLite database expects a
persistent filesystem.

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
