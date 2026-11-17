# Sidetrack

Sidetrack is an agent-first, self-hostable side-project tracker: a calm board
for everything you're building on the side, with a
[Model Context Protocol](https://modelcontextprotocol.io) server built in so
your AI agents can keep it up to date.

![A Sidetrack board with three lists: Recipe app, Blog and Home](docs/board.png)

- 🤖 **Agent first.** Agents read and update your lists over MCP, mark what
  they're working on, and link their pull requests
- 📁 **Lists, items and sub-items**, with emoji labels, due dates, repeats and
  drag to reorder. Pause or archive a list to set it aside
- 🗓️ **Board, Agenda and Done** views, updating live as you or your agents
  make changes
- 👥 **Sharing.** Share a list with someone, or put lists in a Space for a
  household or small team
- 🔀 **GitHub integration.** Pull requests that name an item link to it and
  complete it when they merge
- 📜 **Audit log.** Every change is recorded with who made it: you, a
  collaborator, an agent or GitHub
- 📱 **Installable** as an iOS PWA

Don't want to run it yourself? Sign up at [sidetrack.it](https://sidetrack.it).

## Self-hosting

Sidetrack is a single Node.js server with a SQLite database: no separate
database, cache or queue to run. Any machine with Docker and a persistent disk
will do, such as a VPS or a home server, or a platform with persistent volumes
such as Railway or Fly.io. SQLite rules out serverless platforms without
durable disk.

### Quick start (Docker)

You need [Docker](https://docs.docker.com/get-docker/) with Docker Compose.
There's no prebuilt image yet, so Compose builds one from the source; the
first build takes a few minutes.

1. Get the code:

   ```bash
   git clone https://github.com/fredrivett/sidetrack.git
   cd sidetrack
   ```

2. Create a `.env` file next to `docker-compose.yml`, with a fresh secret and
   the URL you'll open Sidetrack at:

   ```bash
   touch .env
   grep -q '^BETTER_AUTH_SECRET=' .env ||
     echo "BETTER_AUTH_SECRET=$(openssl rand -hex 32)" >> .env
   grep -q '^BETTER_AUTH_URL=' .env ||
     echo "BETTER_AUTH_URL=http://localhost:3000" >> .env
   grep -q '^NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=' .env ||
     echo "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=$(openssl rand -base64 32)" >> .env
   ```

   Each line adds a setting only if `.env` doesn't have it yet, so it's safe to
   re-run, and it fills in anything an older `.env` lacks. It never replaces a
   secret, which would sign everyone out. `BETTER_AUTH_URL` must be the exact
   address in your browser's address bar, or sign-in fails. To reach
   Sidetrack from another device, use that address instead, such as
   `http://192.168.1.20:3000` or `https://sidetrack.example.com`. Keep `.env`
   safe: anyone with the secret can forge a session.

3. Build and start it:

   ```bash
   docker compose up -d --build
   ```

4. Open [http://localhost:3000](http://localhost:3000) and sign up. The
   **first** account claims the instance and signup then locks, so create
   yours before you expose the instance to the internet. To let others sign
   up, set `ALLOW_SIGNUP=true` in `.env` and run `docker compose up -d`; to
   let in a few people, remove it again once they have accounts. Lists can
   then be shared with them from each list's **Share** menu item.

Migrations run automatically on startup, and your data lives in the
`sidetrack-data` Docker volume, which survives rebuilds and restarts. If the
container doesn't come up, `docker compose logs sidetrack` says why: a missing
or invalid setting stops startup with a message naming it.

To serve on a different port, change the left side of `"3000:3000"` in
`docker-compose.yml` (and the port in `BETTER_AUTH_URL`).

### HTTPS and a domain

To use Sidetrack away from home, and to connect claude.ai or GitHub to it, put
it behind a reverse proxy that terminates HTTPS. With
[Caddy](https://caddyserver.com), which fetches certificates itself, the whole
`Caddyfile` is:

```caddyfile
sidetrack.example.com {
	reverse_proxy localhost:3000
}
```

Then set `BETTER_AUTH_URL=https://sidetrack.example.com` in `.env` and apply
it with `docker compose up -d`. Any other proxy works too (nginx, Traefik,
Cloudflare Tunnel); boards update live over a long-lived
[server-sent events](https://developer.mozilla.org/docs/Web/API/Server-sent_events)
connection at `/api/events`, so don't put a short read timeout on it. Once the
proxy is in front, you can change the port mapping to `"127.0.0.1:3000:3000"`
so the plain-HTTP port is only reachable from the machine itself.

### Updating

```bash
git pull
docker compose up -d --build
```

Database migrations run on startup. To be able to go back, copy out the latest
backup first (see [Backups](#backups)). Keep
`NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` the same across updates: Server Action
IDs are derived from it, so with a new key every build, a tab left open through
an update fails its next save and reloads.

### Backups

Sidetrack copies its database to `/data/backups` inside the volume once a day,
keeping the last 7 (`sidetrack-YYYY-MM-DD.db`). Those copies sit on the same
disk as the data, so also copy them somewhere else now and then:

```bash
docker cp sidetrack:/data/backups ./sidetrack-backups
```

To restore one, stop Sidetrack, list the backups, and copy the one you want
over the database, replacing `sidetrack-YYYY-MM-DD.db` with its name. Then
start Sidetrack again:

```bash
docker compose stop sidetrack
docker compose run --rm --no-deps --entrypoint ls sidetrack /data/backups
docker compose run --rm --no-deps --entrypoint sh sidetrack -c \
  'cp /data/backups/sidetrack-YYYY-MM-DD.db /data/sidetrack.db && rm -f /data/sidetrack.db-wal /data/sidetrack.db-shm'
docker compose up -d
```

### Password resets

Without email configured, a password-reset link is printed to the server log
instead of being sent. When someone forgets their password, have them request
a reset, then find the link with `docker compose logs sidetrack` and pass it
on. To send it by email, set `SMTP_URL` (any SMTP server, such as your email
provider's), or set `RESEND_API_KEY` plus `EMAIL_FROM`; see
[Configuration](#configuration).

### Without Docker

Sidetrack runs anywhere with [Node.js](https://nodejs.org) 22 and
[pnpm](https://pnpm.io) (`corepack enable` provides it). In the cloned
repository, create a Server Actions key for the build (see
[Updating](#updating)) unless you have one, then build it and copy the static
files next to the standalone server:

```bash
grep -qs NEXT_SERVER_ACTIONS_ENCRYPTION_KEY .env.local ||
  echo "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=$(openssl rand -base64 32)" >> .env.local
pnpm install --frozen-lockfile
pnpm build
cp -r public .next/standalone/ && cp -r .next/static .next/standalone/.next/
```

The build reads `.env.local`, but the server doesn't read `.env` files itself,
and it runs from inside `.next/standalone`, which the next build replaces. So
put its settings in a file such as `sidetrack.env`, with the data at absolute
paths outside the build:

```bash
BETTER_AUTH_SECRET=...
BETTER_AUTH_URL=https://sidetrack.example.com
DB_PATH=/var/lib/sidetrack/sidetrack.db
BACKUP_DIR=/var/lib/sidetrack/backups
PORT=3000
```

Create the data directory, owned by the user that will run Sidetrack:

```bash
sudo mkdir -p /var/lib/sidetrack
sudo chown "$USER" /var/lib/sidetrack   # or your service account
```

Then start it, and keep it running with your service manager of choice
(systemd, pm2, …):

```bash
NODE_ENV=production node --env-file=sidetrack.env .next/standalone/server.js
```

To update, `git pull`, repeat the build steps, and restart it. The key in
`.env.local` stays the same, so open tabs keep working.

## Configuration

Sidetrack is configured with environment variables. With Docker Compose, put
them in `.env` and apply a change with `docker compose up -d` (build-time
variables, marked below, need `docker compose up -d --build`). Without Docker,
see [Without Docker](#without-docker); for `pnpm dev`, use `.env.local`. A missing or malformed required setting stops the
server at startup with a message saying what to fix.

**Required** in production (the only settings most instances need):

| Variable | Description |
| --- | --- |
| `BETTER_AUTH_SECRET` | Signs session cookies. Generate with `openssl rand -hex 32`, and keep it: changing it signs everyone out |
| `BETTER_AUTH_URL` | The URL you open Sidetrack at, such as `https://sidetrack.example.com`. It must match the browser's address bar exactly (scheme, host and port), and is used for links in emails and the GitHub webhook URL |

**Recommended:**

| Variable | Description |
| --- | --- |
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | **Build-time.** Keeps Server Action IDs the same across builds, so a tab left open through an update can still save. Generate once with `openssl rand -base64 32` and keep it. With plain `docker build`, pass it as `--build-arg` |

**Optional** — signup and data location. The Docker image already puts the
data in its `/data` volume, so leave the paths alone there:

| Variable | Default | Description |
| --- | --- | --- |
| `ALLOW_SIGNUP` | `false` | `true` keeps signup open after the first account. With `false`, the first person to sign up claims the instance and signup then locks |
| `DB_PATH` | `./data/sidetrack.db` | SQLite database path |
| `BACKUP_DIR` | `./data/backups` | Where the daily backups are written (the last 7 are kept) |
| `SIDETRACK_SEED` | `false` | `true` lets `pnpm db:seed` fill a fresh DB with a demo user and sample data. Development and previews only; never set it on a real instance |

**Optional** — outbound email, used for password resets and signup notices.
With nothing set, reset links are printed to the server log instead
(`docker compose logs sidetrack`) for you to pass on:

| Variable | Default | Description |
| --- | --- | --- |
| `SMTP_URL` | unset | Send through any SMTP server, such as `smtps://user:password@smtp.example.com:465` (URL-encode special characters in the password). Takes precedence over Resend. In development it defaults to a local mail catcher; see [`CONTRIBUTING.md`](./CONTRIBUTING.md#email-in-development) |
| `RESEND_API_KEY` | unset | Send through [Resend](https://resend.com) instead |
| `EMAIL_FROM` | `Sidetrack <no-reply@sidetrack.local>` with SMTP | From address, such as `Sidetrack <no-reply@example.com>`. Set it with SMTP too, or mail servers may reject the default. Required with Resend, where its domain must be verified |
| `SIGNUP_NOTIFY_EMAIL` | unset | Your address, to get an email whenever someone new signs up. Sent through SMTP or Resend as above (with neither, the signup is only logged); a failed send never blocks the signup |

**Optional** — AI list-icon suggestions and priority sorting. With it set,
the list icon picker offers emoji picked by
[TypeSafe's Jev](https://docs.typesafe.ai) from the list's name, summary,
homepage domain (not the full URL), and open item titles, and a list's
**Sort items by → Priority** orders its open items as Jev ranks them. That
sort also sends each open item's description, due date and open sub-item
titles. All of this is sent to TypeSafe:

| Variable | Default | Description |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | unset | TypeSafe API key. Unset turns suggestions off |

**Optional** — push notifications (Settings → Notifications), including on
iPhone and iPad once Sidetrack is added to the Home Screen. Generate a key
pair once with `npx web-push generate-vapid-keys` and keep it: changing it
turns push off on every device until it's turned on again:

| Variable | Default | Description |
| --- | --- | --- |
| `VAPID_PUBLIC_KEY` | unset | Public key. Set it and the private key together, or neither; unset turns push off |
| `VAPID_PRIVATE_KEY` | unset | Private key |
| `VAPID_SUBJECT` | `BETTER_AUTH_URL` | Contact for the push services, a `mailto:` or `https://` URL |

**Optional** — analytics and error tracking with your own
[PostHog](https://posthog.com) project. Entirely opt-in: with no keys set,
nothing is sent anywhere, including to the Sidetrack project.

| Variable | Default | Description |
| --- | --- | --- |
| `POSTHOG_KEY` | unset | Project key for server-side error tracking |
| `POSTHOG_HOST` | `https://us.i.posthog.com` | Ingestion host for the server (`https://eu.i.posthog.com` for EU Cloud) |
| `NEXT_PUBLIC_POSTHOG_KEY` | unset | **Build-time.** Project key for pageviews, autocapture and browser errors |
| `NEXT_PUBLIC_POSTHOG_HOST` | `https://us.i.posthog.com` | **Build-time.** Ingestion host for the browser. The Docker build doesn't pass it through, so Docker images always use the US host |

`NEXT_PUBLIC_POSTHOG_KEY` is inlined into the browser bundle at build time,
as all browser analytics are. **Don't bake it into an image you publish**, or
every instance running that image reports into your PostHog project.

<details>
<summary>Build-time variables used by the hosted sidetrack.it deploy (not needed to self-host)</summary>

These tie errors back to the commit that shipped them. Without them a build is
unaffected.

| Variable | Default | Description |
| --- | --- | --- |
| `SOURCE_COMMIT` | `$GITHUB_SHA` | Commit SHA, inlined as `NEXT_PUBLIC_RELEASE`, shown in the account menu and tagged onto every PostHog capture |
| `POSTHOG_API_KEY` | unset | Personal API key. When set with `POSTHOG_PROJECT_ID`, `next build` uploads source maps to PostHog (and deletes them after) so stack traces symbolicate |
| `POSTHOG_PROJECT_ID` | unset | PostHog project id for the source-map upload |
| `POSTHOG_API_HOST` | `https://us.posthog.com` | API host for the upload (note: not the `us.i.` ingestion host) |

</details>

## Using Sidetrack

### Connecting an agent

Sidetrack's MCP server is at `/mcp` on your instance. It authenticates with a
personal API key: create one from **API keys** in the menu under your avatar,
and copy it when it's shown, as it's shown only once. Keys act as the person
who created them, and are revoked from the same page.

**Claude Code:**

```bash
claude mcp add --transport http sidetrack https://your-host/mcp \
  --header "Authorization: Bearer sk_…"
```

**claude.ai:** under Settings → Connectors, add a custom connector with the
URL `https://your-host/mcp?key=sk_…`. claude.ai can't send a custom header, so
the key goes in the URL; treat that URL as a secret.

**Other MCP clients:** point them at `https://your-host/mcp` with an
`Authorization: Bearer sk_…` header, or the `?key=` URL if they can't set
headers.

Hosted clients such as claude.ai connect from the internet, so they need your
instance on a public HTTPS address (see [HTTPS and a domain](#https-and-a-domain)).
A client on the same machine can use `http://localhost:3000/mcp`.

Agents get tools to read and search your lists, add, edit, complete and move
items, mark the item they're working on and report progress, link pull
requests, and manage sharing. Each change appears in the audit log under the
key's name, so you can see which agent did what.

### GitHub webhook

Sidetrack can follow pull requests on its own. Under **GitHub** in the menu
under your avatar, set up a webhook to get a payload URL and secret, then add
them to a repository (Settings → Webhooks, content type `application/json`,
the **Pull requests** event only; untick **Pushes**, which GitHub leaves
ticked). GitHub must be able to reach your instance, so it needs a public
address. After that:

- A PR whose title names items in square brackets, such as
  `Fix login [SDT-1]` or `[SDT-1, SDT-2]`, is linked to those items. Refs
  resolve against your lists and the shared lists you've joined, as the
  webhook's owner. When a bare ref matches items in more than one list,
  qualify it with the list owner's username, such as `[alice/SDT-1]`; a ref
  that matches no item, or several, is skipped.
- Editing a ref out of the title unlinks that item again, unless an agent
  linked it with `link_item_to_pr`. A ref that stops resolving while still in
  the title keeps its link.
- When a PR merges, every item linked to it is completed, whether the link
  came from its title or from an agent's `link_item_to_pr`.
- When a PR closes without merging, agents working on its items are taken off
  them, except on an item with another PR still open (such as a
  replacement); the items stay open.

Each delivery is checked against the webhook's secret, and its changes appear
in the audit log with the `github` source. The webhook works with any number
of repositories; make a new secret or remove it from the same page.

## Contributing

Sidetrack is built with [Next.js](https://nextjs.org),
[React](https://react.dev), [SQLite](https://www.sqlite.org) via
[Drizzle ORM](https://orm.drizzle.team), and
[Tailwind CSS](https://tailwindcss.com) with [shadcn/ui](https://ui.shadcn.com).
See [`CONTRIBUTING.md`](./CONTRIBUTING.md) to run it locally and make changes.

## License

Sidetrack is open source software, licensed under the
[GNU Affero General Public License, version 3 (AGPL-3.0-only)](./LICENSE).
Copyright © 2026 Jotmake Limited.

In short:

- You may use, copy, modify, self-host, and redistribute Sidetrack for any
  purpose, including commercially.
- If you modify Sidetrack and let other people use it over a network (for
  example, by hosting it for them), you must offer those users the source code
  of your modified version under the same license.

See [`LICENSE`](./LICENSE) for the full terms. Versions released before the
switch to the AGPL remain under the
[FSL-1.1-ALv2](https://github.com/fredrivett/sidetrack/blob/d5d4a56c6285cd916b8a54692aa6d52c8ebd5efb/LICENSE.md)
they shipped with, and each converts to the
[Apache License, Version 2.0](https://www.apache.org/licenses/LICENSE-2.0) two
years after its release.
