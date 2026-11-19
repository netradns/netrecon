# ── NetRecon — nginx Frontend Container ──────────────────────────
# Serves the static frontend and proxies /api/* to the dns-proxy sidecar.
# Uses nginx:alpine for a minimal attack surface (~10MB image).
#
# Security notes:
#   - server_tokens off in nginx.conf (no version disclosure)
#   - CSP, X-Frame-Options, X-Content-Type-Options headers set
#   - Rate limiting on all /api/* endpoints
#   - dns-proxy is NOT exposed to the host — internal network only
#   - Real visitor IP is read from X-Forwarded-For only when the connection comes from a
#     trusted proxy (private networks by default, extend with TRUSTED_PROXIES)

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

# Works out the visitor's real IP address behind a proxy or load balancer.
# The nginx image runs everything in /docker-entrypoint.d/ at start. It is also run once
# here so a valid default file exists even if the entrypoint is replaced.
COPY docker/nginx/40-netrecon-realip.sh /docker-entrypoint.d/40-netrecon-realip.sh
RUN chmod +x /docker-entrypoint.d/40-netrecon-realip.sh \
    && /docker-entrypoint.d/40-netrecon-realip.sh

EXPOSE 80

# Healthcheck used by Docker and docker-compose depends_on
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/health || exit 1
