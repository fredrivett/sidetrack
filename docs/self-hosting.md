# Self-hosting Sidetrack

Sidetrack runs as one container with a SQLite database. There's no separate
database, cache or queue.

**You need** Docker with Docker Compose, `curl` and `openssl` (both come with
macOS and most Linux distributions), and a machine with a persistent disk:

- a VPS or home server (amd64 or arm64, such as a Raspberry Pi 4 or 5 on a
  64-bit OS)
- or a platform with persistent volumes, such as Railway or Fly.io

Serverless platforms without a durable disk won't work, because of SQLite.

**Contents**

- [Quick start](#quick-start)
- [Letting other people in](#letting-other-people-in)
- [HTTPS and a domain](#https-and-a-domain)
- [Updating](#updating)
- [Backups](#backups)
- [Password resets](#password-resets)
- [Troubleshooting](#troubleshooting)
- [Configuration](#configuration)
- [Building from source](#building-from-source)
- [Without Docker](#without-docker)

## Quick start

1. **Download the Compose file** into a new folder:

   ```bash
   mkdir sidetrack && cd sidetrack
   curl -fsSLO https://raw.githubusercontent.com/fredrivett/sidetrack/main/docker-compose.yml
   ```

2. **Create `.env`** with a secret and the URL you'll open Sidetrack at:

   ```bash
   touch .env
   grep -q '^BETTER_AUTH_SECRET=' .env ||
     echo "BETTER_AUTH_SECRET=$(openssl rand -hex 32)" >> .env
   grep -q '^BETTER_AUTH_URL=' .env ||
     echo "BETTER_AUTH_URL=http://localhost:3000" >> .env
   ```

   - It's safe to re-run: each line only adds a setting `.env` doesn't have.
     It never replaces the secret, which would sign everyone out.
   - `BETTER_AUTH_URL` must match your browser's address bar exactly, or
     sign-in fails. If Sidetrack runs on another machine, such as a VPS or
     home server, change it in `.env` to that machine's address before you
     start, such as `http://192.168.1.20:3000`.
   - Keep `.env` private: anyone with the secret can forge a session.

3. **Start it:**

   ```bash
   docker compose up -d
   ```

4. **Open the URL in `BETTER_AUTH_URL` and sign up.** The first account
   claims the instance, and signup then locks. Create yours before you expose
   the instance to the internet.

Your data lives in the `sidetrack-data` Docker volume, which survives updates
and restarts. Migrations run on startup.

To use another port, change the left side of `"3000:3000"` in
`docker-compose.yml`, and the port in `BETTER_AUTH_URL`.

## Letting other people in

Signup locks after the first account. To add people:

1. Set `ALLOW_SIGNUP=true` in `.env` and run `docker compose up -d`.
2. Have them sign up.
3. To lock signup again, remove the setting and run `docker compose up -d`.

Then share lists with them from each list's **Share** menu item, or put lists
in a Space, such as for a household or small team.

## HTTPS and a domain

You need a public HTTPS address to use Sidetrack away from home, and to
connect claude.ai or GitHub to it. Put it behind a reverse proxy that handles
HTTPS. With [Caddy](https://caddyserver.com), which gets certificates itself,
this is the whole `Caddyfile`:

```caddyfile
sidetrack.example.com {
	reverse_proxy localhost:3000
}
```

Then set `BETTER_AUTH_URL=https://sidetrack.example.com` in `.env`, and run
`docker compose up -d`.

- **Other proxies** (nginx, Traefik, Cloudflare Tunnel) work too. Boards
  update live over a long-lived connection to `/api/events`
  ([server-sent events](https://developer.mozilla.org/docs/Web/API/Server-sent_events)),
  so don't give it a short read timeout.
- **Close the plain-HTTP port** once the proxy is in front: change the port
  mapping to `"127.0.0.1:3000:3000"`, so only the machine itself can reach it.

## Updating

```bash
docker compose pull
docker compose up -d
```

- **Back up first** to be able to go back: copy out the latest backup
  ([Backups](#backups)). Migrations only go forward.
- **Read the [release notes](https://github.com/fredrivett/sidetrack/releases)**
  for anything an update asks of you, such as a new setting.

### Choosing a version

`docker-compose.yml` follows the latest release. To pick another, set
`SIDETRACK_TAG` in `.env`:

| `SIDETRACK_TAG` | What you get |
| --- | --- |
| `latest` (default) | Each new release |
| `0.1` | Fixes to 0.1, but not 0.2 |
| `0.1.0` | Exactly that release |
| `main` | Every change as it's merged, before it's released |

Released images are rebuilt weekly on a fresh base image to pick up security
fixes, under the same tags.

## Backups

Sidetrack copies its database to `/data/backups` in the volume once a day,
and keeps the last 7 (`sidetrack-YYYY-MM-DD.db`). They're on the same disk as
the data, so copy them somewhere else now and then:

```bash
docker cp sidetrack:/data/backups ./sidetrack-backups
```

To restore a backup:

```bash
# 1. Stop Sidetrack and list the backups
docker compose stop sidetrack
docker compose run --rm --no-deps --entrypoint ls sidetrack /data/backups

# 2. Copy one over the database (replace YYYY-MM-DD with its date)
docker compose run --rm --no-deps --entrypoint sh sidetrack -c \
  'cp /data/backups/sidetrack-YYYY-MM-DD.db /data/sidetrack.db && rm -f /data/sidetrack.db-wal /data/sidetrack.db-shm'

# 3. Start it again
docker compose up -d
```

## Password resets

Without email set up, a reset link is printed to the server log instead of
being sent. When someone forgets their password:

1. Have them request a reset on the sign-in page.
2. Find the link with `docker compose logs sidetrack`.
3. Send it to them.

To email reset links instead, set `SMTP_URL`, or `RESEND_API_KEY` and
`EMAIL_FROM` (see [Email](#email)).

## Troubleshooting

| Problem | Fix |
| --- | --- |
| The container stops right after starting | Run `docker compose logs sidetrack`. A missing or invalid setting stops startup with a message naming it |
| Sign-in fails, or does nothing | `BETTER_AUTH_URL` must match the browser's address bar exactly: scheme, host and port |
| Boards stop updating live behind a proxy | Raise the proxy's read timeout for `/api/events` |
| Nobody else can sign up | Signup locks after the first account; see [Letting other people in](#letting-other-people-in) |

## Configuration

Sidetrack reads its settings from environment variables. With Docker Compose,
put them in `.env` and run `docker compose up -d` to apply a change.

Settings marked **build-time** only apply when you
[build from source](#building-from-source); the published image is built
without them.

### Required

| Variable | Description |
| --- | --- |
| `BETTER_AUTH_SECRET` | Signs session cookies. Generate with `openssl rand -hex 32`. Changing it signs everyone out |
| `BETTER_AUTH_URL` | The URL you open Sidetrack at, such as `https://sidetrack.example.com`. Must match the address bar exactly. Also used for links in emails and the GitHub webhook URL |

### Signup and data

| Variable | Default | Description |
| --- | --- | --- |
| `ALLOW_SIGNUP` | `false` | `true` keeps signup open after the first account |
| `FOUNDING_SEATS` | `false` | `true` shows sidetrack.it's founding batches on the signup page: the first 100 accounts, numbered, in three named batches. Leave it off on your own instance |
| `DB_PATH` | `./data/sidetrack.db` | SQLite database path. The Docker image sets it to the `/data` volume; leave it there |
| `BACKUP_DIR` | `./data/backups` | Where daily backups go (the last 7 are kept). The Docker image sets it to the `/data` volume |
| `SIDETRACK_SEED` | `false` | `true` lets `pnpm db:seed` fill a fresh database with demo data. Development only; never on a real instance |

### Email

Used for password resets and signup notices. With none of these set, reset
links go to the server log ([Password resets](#password-resets)).

| Variable | Default | Description |
| --- | --- | --- |
| `SMTP_URL` | unset | Any SMTP server, such as `smtps://user:password@smtp.example.com:465`. URL-encode special characters in the password. Used before Resend |
| `RESEND_API_KEY` | unset | Send through [Resend](https://resend.com) instead |
| `EMAIL_FROM` | `Sidetrack <no-reply@sidetrack.local>` with SMTP | From address, such as `Sidetrack <no-reply@example.com>`. Required with Resend, where its domain must be verified. Worth setting with SMTP too, as servers may reject the default |
| `SIGNUP_NOTIFY_EMAIL` | unset | Your address, to be emailed when someone new signs up. Needs SMTP or Resend (otherwise it's only logged). A failed send never blocks the signup |

### Feedback

| Variable | Default | Description |
| --- | --- | --- |
| `FEEDBACK_LIST_ID` | unset | The id of one of your lists (the `p=` in its URL). Shows a **Send feedback** button in everyone's header and files each one there as an item labelled Bug, Idea or Other and Feedback, with who sent it, their page and build, and PostHog replay links when PostHog is on. Senders don't join the list or see what others sent. Unset hides the form |

### AI suggestions

| Variable | Default | Description |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | unset | Turns on AI features from [TypeSafe's Jev](https://docs.typesafe.ai). Unset turns them off |

With it set:

- **The list icon picker suggests emoji.** It sends the list's name, summary,
  homepage domain (not the full URL) and open item titles to TypeSafe.
- **Sort items by → Priority** orders a list's open items as Jev ranks them.
  It also sends each open item's description, due date and open sub-item
  titles.

### Push notifications

For notifications in Settings → Notifications, including on iPhone and iPad once
Sidetrack is added to the Home Screen. Generate a key pair once with
`npx web-push generate-vapid-keys`, and keep it: changing it turns push off on
every device until each turns it on again.

| Variable | Default | Description |
| --- | --- | --- |
| `VAPID_PUBLIC_KEY` | unset | Public key. Set it and the private key together, or neither. Unset turns push off |
| `VAPID_PRIVATE_KEY` | unset | Private key |
| `VAPID_SUBJECT` | `BETTER_AUTH_URL` | Contact for the push services: a `mailto:` or `https://` URL |

### Analytics and error tracking

Opt-in, with your own [PostHog](https://posthog.com) project. With no keys
set, nothing is sent anywhere, including to the Sidetrack project.

| Variable | Default | Description |
| --- | --- | --- |
| `POSTHOG_KEY` | unset | Project key for server-side error tracking |
| `POSTHOG_HOST` | `https://us.i.posthog.com` | Server ingestion host (`https://eu.i.posthog.com` for EU Cloud) |
| `NEXT_PUBLIC_POSTHOG_KEY` | unset | **Build-time.** Project key for pageviews, autocapture, browser errors and session replay (on when the PostHog project turns it on). Signed-in people are identified by user id and username. Element text and attributes are masked. Replays mask inputs, images and everything people wrote, and show only the app's own words, marked `data-replay-safe` (see `src/lib/replayPrivacy.ts`) |
| `NEXT_PUBLIC_POSTHOG_HOST` | `https://us.i.posthog.com` | **Build-time.** Browser ingestion host. The Docker build doesn't pass it through, so Docker builds use the US host |

`NEXT_PUBLIC_POSTHOG_KEY` is built into the browser bundle. **Don't build it
into an image you publish**, or every instance of that image reports into your
PostHog project.

### Build stability

| Variable | Description |
| --- | --- |
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | **Build-time, recommended.** Keeps Server Action IDs the same across builds, so a tab left open through an update can still save. Generate once with `openssl rand -base64 32` and keep it. With plain `docker build`, pass it as `--build-arg`. The published image has its own |

<details>
<summary>Build-time settings used by the hosted sidetrack.it deploy (not needed to self-host)</summary>

These tie errors to the commit that shipped them. A build without them is
unaffected.

| Variable | Default | Description |
| --- | --- | --- |
| `SOURCE_COMMIT` | `$GITHUB_SHA` | Commit SHA, inlined as `NEXT_PUBLIC_RELEASE`, shown in the account menu and tagged onto every PostHog capture |
| `POSTHOG_API_KEY` | unset | Personal API key. With `POSTHOG_PROJECT_ID`, `next build` uploads source maps to PostHog (and deletes them after) so stack traces symbolicate |
| `POSTHOG_PROJECT_ID` | unset | PostHog project ID for the source-map upload |
| `POSTHOG_API_HOST` | `https://us.posthog.com` | API host for the upload (not the `us.i.` ingestion host) |

</details>

## Building from source

Build your own image to run your own changes, or to build in your own PostHog
key. In a clone of the repository:

```bash
git clone https://github.com/fredrivett/sidetrack.git
cd sidetrack
# Create .env as in the quick start, then add a Server Actions key once:
grep -q '^NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=' .env ||
  echo "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=$(openssl rand -base64 32)" >> .env
# Optional: your own PostHog key for browser analytics
# echo "NEXT_PUBLIC_POSTHOG_KEY=phc_…" >> .env
docker compose up -d --build
```

- The first build takes a few minutes.
- **To update:** `git pull`, then `docker compose up -d --build`.
- **Don't run `docker compose pull`** on a source build: it replaces your
  image with the published one.

## Without Docker

You need [Node.js](https://nodejs.org) 22 and [pnpm](https://pnpm.io)
(`corepack enable` provides it).

1. **Build it** in a clone of the repository. The first line adds a Server
   Actions key to `.env.local` once (see
   [Build stability](#build-stability)); the build reads it from there.

   ```bash
   grep -qs '^NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=' .env.local ||
     echo "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=$(openssl rand -base64 32)" >> .env.local
   pnpm install --frozen-lockfile
   pnpm build
   cp -r public .next/standalone/ && cp -r .next/static .next/standalone/.next/
   ```

2. **Write the server's settings** to a file such as `sidetrack.env`. The
   server doesn't read `.env` files itself. It runs from inside
   `.next/standalone`, which each build replaces, so keep the data at absolute
   paths outside it:

   ```bash
   BETTER_AUTH_SECRET=...
   BETTER_AUTH_URL=https://sidetrack.example.com
   DB_PATH=/var/lib/sidetrack/sidetrack.db
   BACKUP_DIR=/var/lib/sidetrack/backups
   PORT=3000
   ```

3. **Create the data directory**, owned by the user that runs Sidetrack:

   ```bash
   sudo mkdir -p /var/lib/sidetrack
   sudo chown "$USER" /var/lib/sidetrack   # or your service account
   ```

4. **Start it**, and keep it running with a service manager such as systemd
   or pm2:

   ```bash
   NODE_ENV=production node --env-file=sidetrack.env .next/standalone/server.js
   ```

**To update:** `git pull`, repeat step 1, and restart the server.
