# ── NetRecon — nginx Frontend Container ──────────────────────────
# Serves the static frontend and proxies /api/* to the dns-proxy sidecar.
# Uses nginx:alpine for a minimal attack surface (~10MB image).
#
# Security notes:
#   - server_tokens off in nginx.conf (no version disclosure)
#   - CSP, X-Frame-Options, X-Content-Type-Options headers set
#   - Rate limiting on all /api/* endpoints
#   - dns-proxy is NOT exposed to the host — internal network only

FROM nginx:1.28-alpine

# Remove default nginx content and default server config
# to prevent any accidental exposure of default pages
RUN rm -rf /usr/share/nginx/html/* \
    && rm -f /etc/nginx/conf.d/default.conf

# Copy frontend assets
COPY frontend/ /usr/share/nginx/html/

# Ensure nginx worker can read all frontend files
RUN chmod -R 755 /usr/share/nginx/html

# Replace the full nginx config with our hardened version
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 80

# Healthcheck used by Docker and docker-compose depends_on
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/health || exit 1
