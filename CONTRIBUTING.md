# Contributing to Sidetrack

## Running it locally

You need [Node.js](https://nodejs.org) 22 and [pnpm](https://pnpm.io)
(`corepack enable` provides it).

```bash
pnpm install
echo "BETTER_AUTH_SECRET=$(openssl rand -hex 32)" >> .env.local
pnpm dev
```

The app starts at [http://localhost:3000](http://localhost:3000). Before it
starts, `pnpm dev` applies migrations to the SQLite database at
`./data/sidetrack.db` and, when the database has no users yet, fills it with
demo data. Log in as `demo@sidetrack.local` with the password
`sidetrack-demo`. To start over, stop the server and delete `./data`.

`BETTER_AUTH_URL` is optional locally: Better Auth infers the origin from each
request, so the dev server also works on another port, such as one per git
worktree. Other settings go in `.env.local` too; see the README's
[Configuration](./README.md#configuration).

### Email in development

In development, outbound email such as password resets goes to a local
[Mailpit](https://mailpit.axllent.org) mail catcher, so a dev box never sends
real email. Start it (it needs Docker) before you trigger a send, and read the
messages in its web UI:

```bash
pnpm mailpit   # web UI at http://localhost:8025
```

If Mailpit isn't running, sends fail and the server log says so. To point at
another catcher, set `SMTP_URL`; to send real email, set `RESEND_API_KEY` and
`EMAIL_FROM`.

## Making changes

[`AGENTS.md`](./AGENTS.md) describes the project layout and the rules changes
follow, such as recording every change in the audit log and how the UI shows
saves. Directories have their own `AGENTS.md` for their conventions. It's
written for coding agents, but it's the best map of the code for people too.

After changing the schema in `src/core/schema.ts` or `src/core/auth-schema.ts`,
run `pnpm db:generate` and commit the migration it writes; it's applied on the next startup. CI fails
when a schema change has no migration.

Before opening a pull request, run `pnpm lint`, `pnpm exec tsc --noEmit` and
`pnpm test`. CI runs these, a production build, a check that the demo seed
still works, and a semgrep security scan.

| Command | Description |
| --- | --- |
| `pnpm dev` | Start the development server (migrates and seeds first) |
| `pnpm mailpit` | Start the local Mailpit mail catcher |
| `pnpm build` | Production build |
| `pnpm lint` | Run ESLint |
| `pnpm test` | Run the Vitest suite |
| `pnpm test:mutation` | Mutation-test the core domain logic with Stryker (slow; not run in CI) |
| `pnpm db:generate` | Generate a migration from schema changes |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:seed` | Fill a fresh database with demo data (needs `SIDETRACK_SEED=true`) |

## License

Contributions are accepted under the project's license,
[AGPL-3.0-only](./LICENSE).
