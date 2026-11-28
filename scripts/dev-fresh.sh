#!/usr/bin/env bash
# Runs the dev server against an empty database of its own, for seeing
# Sidetrack as someone who has just signed up: onboarding (the Agenda's Get
# started stack), empty states, sign-up and invites. Your usual
# data/sidetrack.db isn't touched.
#
#   pnpm dev:fresh          wipe the fresh DB and start again from nothing
#   pnpm dev:fresh --keep   carry on with the accounts from last time
#
# Not seeded: demo users and sample data are the opposite of a new account.
# Next allows one `next dev` per checkout, so stop your normal dev server
# first.
set -euo pipefail

cd "$(dirname "$0")/.."

export DB_PATH=./data/fresh.db
export ALLOW_SIGNUP=true
# Next reads PORT itself; in Conductor, use the workspace's port.
if [[ -n "${CONDUCTOR_PORT:-}" ]]; then export PORT="${PORT:-$CONDUCTOR_PORT}"; fi

if [[ "${1:-}" != "--keep" ]]; then
  rm -f "$DB_PATH" "$DB_PATH-wal" "$DB_PATH-shm" "$DB_PATH-journal"
  echo "[fresh] empty database at $DB_PATH"
fi

pnpm db:migrate

echo "[fresh] once it's up, sign up at <the URL below>/login?mode=sign-up"
exec pnpm exec next dev
