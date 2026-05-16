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

# Runs as root: the data dir is a runtime-mounted volume (Railway Volume
# or a docker-compose bind) owned by root; a non-root user would hit
# EACCES on it. App is single-user and gated by token auth.
RUN mkdir -p /data /data/backups
EXPOSE 3000

CMD ["node", "server.js"]
