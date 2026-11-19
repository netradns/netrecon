# ── NetRecon — DNS Proxy Container ───────────────────────────────
# Lightweight Node.js sidecar that handles:
#   - Public DNS lookups via Cloudflare DoH (1.1.1.1)
#   - Internal DNS lookups via your private DNS servers (UDP)
#   - IP geolocation via ipinfo.io / ip-api.com
#   - Admin login, settings, watched domains and usage stats (persisted in /data)
#
# Security notes:
#   - Runs as the unprivileged "node" user. The entrypoint starts as root only to make
#     /data writable (so a new volume or an older root-owned data folder both just work),
#     then drops privileges. If /data cannot be made writable it falls back to root
#     rather than failing.
#   - Zero npm dependencies — only Node.js built-ins
#   - Not exposed to the host — internal Docker network only
#   - nginx handles all rate limiting and input validation upstream
#
# Image size: ~60MB (node:22-alpine base)
FROM node:22-alpine

# Set production mode — disables dev-only Node.js features
ENV NODE_ENV=production

# su-exec: tiny tool the entrypoint uses to drop from root to the "node" user
RUN apk add --no-cache su-exec

WORKDIR /app

# Copy application source
COPY server.js reset-password.js ./
COPY lib/ ./lib/

# Entrypoint prepares /data and drops privileges (see docker-entrypoint.sh)
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Create the data directory. A volume mounted here keeps settings across restarts.
RUN mkdir -p /data && chown node:node /data

# Internal port — only accessible within the Docker network
EXPOSE 3053

# Healthcheck: verify the HTTP server is responding
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3053/health || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
