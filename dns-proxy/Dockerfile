# ── NetRecon — DNS Proxy Container ───────────────────────────────
# Lightweight Node.js sidecar that handles:
#   - Public DNS lookups via Cloudflare DoH (1.1.1.1)
#   - Internal DNS lookups via your private DNS servers (UDP)
#   - IP geolocation via ipinfo.io / ip-api.com
#   - Usage stats persistence to /data/stats.json
#
# Security notes:
#   - Runs as non-root user 'dnsapp' (UID 1000)
#   - Zero npm dependencies — only Node.js built-ins
#   - Not exposed to host or Traefik — internal Docker network only
#   - nginx handles all rate limiting and input validation upstream
#
# Image size: ~60MB (node:22-alpine base)

FROM node:22-alpine

# Set production mode — disables dev-only Node.js features
ENV NODE_ENV=production

WORKDIR /app

# Copy application source
COPY server.js .
COPY lib/ ./lib/

# Create the data directory — will be overridden by volume mount at runtime
# but ensures the path exists if no volume is mounted
RUN mkdir -p /data

# Internal port — only accessible within the Docker network
EXPOSE 3053

# Healthcheck: verify the HTTP server is responding
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3053/health || exit 1

CMD ["node", "server.js"]
