# syntax=docker/dockerfile:1.7
# Pinned to an exact version so Dependabot can bump it; keep both FROM lines
# in step.
FROM node:22.23.5-alpine AS base
RUN apk add --no-cache libc6-compat
RUN corepack enable
WORKDIR /app

# ---------- Dependencies ----------
FROM base AS deps
# better-sqlite3 may need node-gyp if no prebuilt binary exists for musl.
RUN apk add --no-cache python3 make g++
COPY package.json pnpm-lock.yaml ./
# Hoisted node_modules so we can copy better-sqlite3 directly into the
# runtime image without chasing pnpm symlinks.
RUN pnpm install --frozen-lockfile --config.node-linker=hoisted

# ---------- Build ----------
FROM base AS builder
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* values are inlined into the client bundle during `next build`,
# so they must be present AT BUILD TIME — a runtime-only env var is too late.
# Railway passes a service variable into a Dockerfile build only when a matching
# ARG is declared, so declare the public PostHog key here and promote it to ENV
# before the build. Without this the client bundle ships no key, posthog never
# initializes, and client-side error capture is a silent no-op.
# Only the key: instrumentation-client guards it with `if (key)`, so an empty
# value is safely treated as "unset". We deliberately do NOT thread the host the
# same way — it's read with `?? default`, where an empty string would clobber
# the default with "".
ARG NEXT_PUBLIC_POSTHOG_KEY
ENV NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY
# Build-only inputs read by next.config.ts during `pnpm build`. Without these
# ARGs Railway never passes them in, so builds shipped with no release tag and
# no source maps. They are visible to RUN as env vars and, being builder-stage
# only, never reach the runtime image.
# - The commit SHA: inlined as NEXT_PUBLIC_RELEASE, which tags every PostHog
#   capture (the deploy marker). Railway provides RAILWAY_GIT_COMMIT_SHA.
# - The PostHog personal API key, project ID and API host: enable the
#   source-map upload.
# - The Server Actions encryption key: Server Action IDs hash it, and without
#   one `next build` makes a fresh key (each Docker build starts with no
#   .next/cache), so every deploy renamed every action and open tabs failed
#   their next save. A fixed key keeps an action's ID until it is renamed.
# POSTHOG_API_KEY and NEXT_SERVER_ACTIONS_ENCRYPTION_KEY are secrets passed as
# ARGs on purpose: Railway doesn't support BuildKit secret mounts for
# Dockerfile builds, and its documented pattern for build-time secrets is an
# ARG in a builder stage. Never expand them on a RUN line (e.g.
# `RUN X=$POSTHOG_API_KEY ...`); Railway logs the expanded command.
# `pnpm build` reads them from the environment instead.
ARG SOURCE_COMMIT
ARG RAILWAY_GIT_COMMIT_SHA
ARG POSTHOG_API_KEY
ARG POSTHOG_PROJECT_ID
ARG POSTHOG_API_HOST
ARG NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build
# Stage the native module (deref symlinks just in case) so the runner can
# copy it without touching pnpm's virtual store.
RUN mkdir -p /native \
    && cp -RL node_modules/better-sqlite3 /native/ \
    && cp -RL node_modules/bindings /native/ \
    && cp -RL node_modules/file-uri-to-path /native/

# ---------- Runtime ----------
FROM node:22.23.5-alpine AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV DB_PATH=/data/sidetrack.db
ENV BACKUP_DIR=/data/backups

# su-exec lets the entrypoint drop from root to the unprivileged `node` user
# after fixing volume ownership.
RUN apk add --no-cache su-exec

WORKDIR /app

# Next.js standalone output: contains server.js + minimal traced node_modules.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# better-sqlite3 is marked serverExternalPackages, so it is NOT in the
# standalone trace. Add it explicitly alongside its peers.
COPY --from=builder /native/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=builder /native/bindings ./node_modules/bindings
COPY --from=builder /native/file-uri-to-path ./node_modules/file-uri-to-path

# Drizzle migrations are read at runtime by core/migrate.ts.
COPY --from=builder /app/src/core/migrations ./src/core/migrations

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /data /data/backups

EXPOSE 3000

# The container starts as root so the entrypoint can chown the mounted /data
# volume, then immediately drops to the unprivileged `node` user via su-exec
# (see docker-entrypoint.sh). There is intentionally no final USER directive —
# privilege-dropping happens at runtime, after volume perms are fixed.
# nosemgrep: dockerfile.security.missing-user-entrypoint.missing-user-entrypoint
ENTRYPOINT ["docker-entrypoint.sh"]
# nosemgrep: dockerfile.security.missing-user.missing-user
CMD ["node", "server.js"]
