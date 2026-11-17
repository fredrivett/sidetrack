# Contributing to Sidetrack

## Running it locally

You need [Node.js](https://nodejs.org) 22 and [pnpm](https://pnpm.io)
(`corepack enable` provides it).

```bash
pnpm install
echo "BETTER_AUTH_SECRET=$(openssl rand -hex 32)" >> .env.local
pnpm dev
```

The app starts at [http://localhost:3000](http://localhost:3000).

- **Demo data:** before starting, `pnpm dev` applies migrations to
  `./data/sidetrack.db` and, if it has no users yet, fills it with demo data.
  Log in as `demo@sidetrack.local` with the password `sidetrack-demo`.
- **Starting over:** stop the server and delete `./data`.
- **Settings** go in `.env.local`; see
  [Configuration](./docs/self-hosting.md#configuration). `BETTER_AUTH_URL` is
  optional locally, so the dev server works on any port, such as one per git
  worktree.

### Email in development

In development, email such as password resets goes to a local
[Mailpit](https://mailpit.axllent.org) mail catcher, so a dev box never sends
real email. Start it (it needs Docker) before you trigger a send:

```bash
pnpm mailpit   # read messages at http://localhost:8025
```

- If Mailpit isn't running, sends fail and the server log says so.
- To use another catcher, set `SMTP_URL`.
- To send real email, set `RESEND_API_KEY` and `EMAIL_FROM`.

## Making changes

- **Read [`AGENTS.md`](./AGENTS.md) first.** It maps the code and sets the
  rules changes follow, such as recording every change in the audit log and
  how the UI shows saves. Directories have their own `AGENTS.md`. They're
  written for coding agents, but work just as well for people.
- **Schema changes:** after editing `src/core/schema.ts` or
  `src/core/auth-schema.ts`, run `pnpm db:generate` and commit the migration
  it writes. It's applied on the next startup, and CI fails without it.
- **Before opening a pull request,** run `pnpm lint`, `pnpm exec tsc --noEmit`
  and `pnpm test`. CI also runs a production build, a check that the demo
  seed still works, and a semgrep security scan.

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
