#!/bin/sh
# NetRecon dns-proxy: start as an unprivileged user, whatever owns /data.
#
# The container starts as root only long enough to make /data writable for the
# unprivileged "node" user, then hands over. This is what lets a fresh
# "docker compose up" work with ./data or a named volume, and lets an existing
# install (whose data files are owned by root from older versions) upgrade
# without any manual chown.
#
# If /data cannot be made writable (some network shares refuse chown), the
# proxy runs as root instead, so saving settings keeps working. Nothing breaks.

if [ "$(id -u)" = "0" ] && command -v su-exec >/dev/null 2>&1; then
  mkdir -p /data
  chown -R node:node /data 2>/dev/null || true

  if su-exec node test -w /data 2>/dev/null; then
    exec su-exec node "$@"
  fi

  echo "[netrecon] /data is not writable by the unprivileged user (a network share or read-only mount?)." >&2
  echo "[netrecon] Running as root so settings can still be saved." >&2
fi

exec "$@"
