# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS base
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
FROM node:${NODE_VERSION} AS runner
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
