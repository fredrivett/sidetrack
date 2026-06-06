#!/bin/sh
# Fix ownership of the runtime-mounted data volume, then drop privileges.
#
# The container starts as root only so it can chown /data (which may be a
# freshly-mounted, root-owned Railway Volume or docker-compose bind) to the
# unprivileged `node` user. The app itself never runs as root: su-exec hands
# off to `node` for the actual process.
set -e

mkdir -p /data /data/backups

if [ "$(id -u)" = "0" ]; then
  chown -R node:node /data
  exec su-exec node "$@"
fi

# Already non-root (some platforms force a UID): run as-is.
exec "$@"
